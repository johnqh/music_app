/**
 * Adapts `building_blocks`' link contract to React Router.
 *
 * The library renders navigation through whatever `LinkComponent` it is given,
 * passing the destination as `href`. React Router's `Link` navigates by `to`
 * and does not merely ignore `href` — it overwrites it with `useHref(to)`, so
 * handing `Link` over directly makes every item resolve to the current page
 * and the menu appears dead. `sudojo_app` bridges the two the same way.
 *
 * Unlocalized on purpose: this app's menu hrefs are already built with their
 * `/:lang` prefix, so there is nothing left to prepend.
 */
import { Link } from 'react-router-dom';
import type { LinkComponentProps } from '@sudobility/building_blocks';

export const LinkWrapper = ({ href, className, children, onClick }: LinkComponentProps) => (
  <Link to={href} className={className} onClick={onClick}>
    {children}
  </Link>
);
