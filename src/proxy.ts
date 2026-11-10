/**
 * Proxy Next.js : en-têtes de sécurité et redirection « optimiste ».
 *
 * Il ne décide JAMAIS d'un droit d'accès : il se contente de renvoyer vers la
 * page de connexion un visiteur sans cookie. La vérification réelle (session
 * valide en base, rôle, permission) est faite à chaque page et à chaque
 * Server Action par src/serveur/session-next.ts.
 */
import { NextResponse, type NextRequest } from 'next/server';

const COOKIE_SESSION = 'ys_session';

export function proxy(requete: NextRequest) {
  const { pathname } = requete.nextUrl;
  const publique = pathname === '/connexion' || pathname.startsWith('/api/sante');
  if (!publique && !requete.cookies.get(COOKIE_SESSION)?.value) {
    const cible = new URL('/connexion', requete.url);
    if (pathname !== '/' && !pathname.startsWith('/api/')) cible.searchParams.set('suite', pathname);
    return NextResponse.redirect(cible);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const developpement = process.env.NODE_ENV === 'development';
  // Aperçu intégré (démonstration dans une iframe) : voir src/serveur/config.ts.
  const integre = process.env.YS_APERCU_INTEGRE === '1';
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${developpement ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' 'nonce-${nonce}'${developpement ? ` 'unsafe-inline'` : ''}`,
    `style-src-attr 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors ${integre ? 'https:' : `'none'`}`,
  ].join('; ');

  const entetes = new Headers(requete.headers);
  entetes.set('x-nonce', nonce);
  entetes.set('content-security-policy', csp);
  const reponse = NextResponse.next({ request: { headers: entetes } });
  reponse.headers.set('Content-Security-Policy', csp);
  reponse.headers.set('X-Content-Type-Options', 'nosniff');
  // Les liens sortants vers les annonces n'indiquent pas d'où vient le clic.
  reponse.headers.set('Referrer-Policy', 'no-referrer');
  reponse.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  reponse.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  if (!integre) reponse.headers.set('X-Frame-Options', 'DENY');
  // Outil interne contenant des données personnelles : jamais de cache partagé.
  reponse.headers.set('Cache-Control', 'private, no-store');
  return reponse;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|marque/|icon.png|apple-icon.png|favicon.ico).*)',
    },
  ],
};
