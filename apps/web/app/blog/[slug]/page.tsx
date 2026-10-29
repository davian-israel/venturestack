import { notFound } from 'next/navigation';
import { marked } from 'marked';
import { apiGet } from '@/lib/api';

export const revalidate = 3600;

const strip = (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/ on\w+="[^"]*"/gi, '');

export default async function Post({ params }: { params: Promise<{ slug: string }> }) {
  const p = await apiGet<{ title: string; body: string; product_slug: string; created_at: string }>(`/blog/${(await params).slug}`);
  if (!p) notFound();
  return (
    <article className="post">
      <h1>{p.title}</h1>
      <p className="muted">{new Date(p.created_at).toLocaleDateString('en-GB')}</p>
      <div dangerouslySetInnerHTML={{ __html: strip(marked.parse(p.body.replace(/^# .*\n/, '')) as string) }} />
      <p><a className="btn" href={`/p/${p.product_slug}`}>See how we do this for you</a></p>
    </article>
  );
}
