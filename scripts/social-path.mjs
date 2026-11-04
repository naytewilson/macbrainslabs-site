// Deterministic, collision-resistant filenames for static social images.
// Shared by rendering, source verification and publication refresh.
export function socialPathForRoute(route) {
  if (route === '/') return '/assets/social-card.png';
  if (!/^\/(?:[a-z0-9_-]+\/)*$/.test(route)) throw new Error('Invalid public route for social image: ' + route);
  const slug = route.replace(/^\/|\/$/g, '').replace(/\//g, '-');
  if (!slug || slug.length > 160) throw new Error('Unexpected social route slug: ' + slug);
  return '/assets/social/' + slug + '.png';
}
