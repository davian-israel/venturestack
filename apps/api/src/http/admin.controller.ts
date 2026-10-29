import { BadRequestException, Body, CanActivate, Controller, ExecutionContext, Get, HttpCode, Injectable, Post, Put, UnauthorizedException, UseGuards } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { PRODUCTS } from '@vs/catalog';
import { config } from '../config';
import { q } from '../db/db';
import { sendMail } from '../mail/mailer';
import { enqueue } from '../jobs/queue';
import { computeMetrics } from '../growth/metrics';
import { BOUNDS, getSettings, saveSettings } from '../growth/settings';

/** Owner-only access: the sign-in link is only ever emailed to OWNER_EMAIL. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const h: string | undefined = ctx.switchToHttp().getRequest().headers.authorization;
    try {
      const p = jwt.verify(h?.slice(7) ?? '', config.JWT_SECRET) as { kind: string; email: string };
      if (p.kind !== 'admin' || p.email !== config.OWNER_EMAIL) throw new Error();
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}

@Controller('admin')
export class AdminAuthController {
  @Post('magic')
  @HttpCode(200)
  async magic() {
    const token = jwt.sign({ kind: 'admin-magic', email: config.OWNER_EMAIL }, config.JWT_SECRET, { expiresIn: '15m' });
    await sendMail(config.OWNER_EMAIL, 'Dashboard sign-in', `<p><a href="${config.PUBLIC_WEB_URL}/admin?token=${token}">Open your business dashboard</a> (valid 15 minutes).</p>`);
    return { ok: true };
  }

  @Post('exchange')
  @HttpCode(200)
  exchange(@Body() body: { token: string }) {
    try {
      const p = jwt.verify(body?.token ?? '', config.JWT_SECRET) as { kind: string; email: string };
      if (p.kind !== 'admin-magic' || p.email !== config.OWNER_EMAIL) throw new Error();
    } catch {
      throw new UnauthorizedException();
    }
    return { session: jwt.sign({ kind: 'admin', email: config.OWNER_EMAIL }, config.JWT_SECRET, { expiresIn: '7d' }) };
  }
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  @Get('metrics')
  metrics() {
    return computeMetrics();
  }

  /** Manual overrides from the dashboard — same bounds as the optimiser, and logged. */
  @Put('settings')
  async settings(@Body() body: { paused?: string[]; maxWave?: number; targetDate?: string; fixedMonthlyCostUsd?: number; dailySendCap?: number }) {
    const s = await getSettings();
    const changes: string[] = [];
    if (body.paused) {
      const valid = body.paused.filter((x) => PRODUCTS.some((p) => p.slug === x));
      changes.push(`paused → [${valid.join(', ') || 'none'}]`);
      s.paused = valid;
    }
    if (body.maxWave !== undefined) {
      if (![1, 2, 3].includes(body.maxWave)) throw new BadRequestException('maxWave must be 1, 2 or 3');
      changes.push(`wave ${s.maxWave} → ${body.maxWave}`);
      s.maxWave = body.maxWave;
    }
    if (body.targetDate !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.targetDate)) throw new BadRequestException('targetDate must be YYYY-MM-DD');
      changes.push(`target date → ${body.targetDate}`);
      s.targetDate = body.targetDate;
    }
    if (body.fixedMonthlyCostUsd !== undefined) {
      s.fixedMonthlyCostCents = Math.max(0, Math.round(body.fixedMonthlyCostUsd * 100));
      changes.push(`fixed costs → $${body.fixedMonthlyCostUsd}/mo`);
    }
    if (body.dailySendCap !== undefined) {
      s.dailySendCap = Math.min(BOUNDS.dailySendCapCeiling, Math.max(BOUNDS.dailySendCapMin, Math.round(body.dailySendCap)));
      changes.push(`send cap → ${s.dailySendCap}/day`);
    }
    await saveSettings(s);
    if (changes.length) {
      await q(`INSERT INTO optimiser_log (week, kind, summary, detail) VALUES (CURRENT_DATE,'change',$1,$2)`, [`Manual: ${changes.join('; ')}`, { manual: true }]);
    }
    return s;
  }

  @Post('optimise')
  @HttpCode(202)
  async optimise() {
    await q(`DELETE FROM optimiser_log WHERE week=CURRENT_DATE AND kind='review'`); // allow a re-run today
    await enqueue({ type: 'optimise' });
    return { queued: true };
  }
}
