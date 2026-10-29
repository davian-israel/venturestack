import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config } from './config';
import { migrate } from './db/migrate';
import { BillingService } from './billing/billing.service';
import { EntitlementGuard, SessionGuard } from './auth/auth';
import { PortalController, PublicController } from './http/controllers';

@Module({
  controllers: [PublicController, PortalController],
  providers: [BillingService, SessionGuard, EntitlementGuard],
})
class AppModule {}

async function bootstrap() {
  await migrate();
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors({ origin: [config.PUBLIC_WEB_URL], credentials: true });
  app.enableShutdownHooks();
  // Railway private networking is IPv6; fall back to IPv4 where IPv6 is unavailable.
  await app.listen(config.PORT, '::').catch(() => app.listen(config.PORT, '0.0.0.0'));
  console.log(`api listening on ${config.PORT}`);
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
