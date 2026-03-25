import React, { type ReactNode } from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { useThemeConfig, type NavbarLogo } from '@docusaurus/theme-common';
import ThemedImage from '@theme/ThemedImage';

function LogoThemedImage({
  logo,
  alt,
  imageClassName,
}: {
  logo: NavbarLogo;
  alt: string;
  imageClassName?: string;
}) {
  const sources = {
    light: useBaseUrl(logo.src),
    dark: useBaseUrl(logo.srcDark || logo.src),
  };

  const themedImage = (
    <ThemedImage
      className={logo.className}
      sources={sources}
      height={logo.height}
      width={logo.width}
      alt={alt}
      style={logo.style}
    />
  );

  return imageClassName ? (
    <div className={imageClassName}>{themedImage}</div>
  ) : (
    themedImage
  );
}

function NavbarBrandTitle({
  title,
  className,
}: {
  title: string;
  className?: string;
}) {
  if (!title.startsWith('TradeJS')) {
    return <b className={className}>{title}</b>;
  }

  const suffix = title.slice('TradeJS'.length).trim();

  return (
    <b className={[className, 'tradejs-navbar-title'].filter(Boolean).join(' ')}>
      <span className="tradejs-navbar-word">Trade</span>
      <span className="tradejs-navbar-js">JS</span>
      {suffix ? <span className="tradejs-navbar-suffix">{suffix}</span> : null}
    </b>
  );
}

export default function NavbarLogo(): ReactNode {
  const {
    siteConfig: { title },
  } = useDocusaurusContext();
  const {
    navbar: { title: navbarTitle, logo },
  } = useThemeConfig();

  const logoLink = useBaseUrl(logo?.href || '/');
  const fallbackAlt = navbarTitle ? '' : title;
  const alt = logo?.alt ?? fallbackAlt;

  return (
    <Link
      to={logoLink}
      className="navbar__brand"
      {...(logo?.target && { target: logo.target })}
    >
      {logo ? (
        <LogoThemedImage
          logo={logo}
          alt={alt}
          imageClassName="navbar__logo"
        />
      ) : null}
      {navbarTitle ? (
        <NavbarBrandTitle
          title={navbarTitle}
          className="navbar__title text--truncate"
        />
      ) : null}
    </Link>
  );
}
