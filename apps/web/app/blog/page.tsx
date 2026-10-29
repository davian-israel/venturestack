import { apiGet } from '@/lib/api';

export const revalidate = 600;

export default async function Blog() {
  const posts = (await apiGet<{ slug: string; title: string; created_at: string }[]>('/blog')) ?? [];
  return (
    <>
      <h1>Guides</h1>
      {posts.length === 0 && <p className="muted">New guides are published every week.</p>}
      {posts.map((p) => (
        <p key={p.slug}><a href={`/blog/${p.slug}`}>{p.title}</a> <span className="muted">· {new Date(p.created_at).toLocaleDateString('en-GB')}</span></p>
      ))}
    </>
  );
}
