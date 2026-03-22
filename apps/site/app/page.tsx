import { LandingPage } from '@/components/tradejs/landing-page';

export default function Page() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        name: 'TradeJS',
        url: 'https://tradejs.dev',
        inLanguage: 'en',
        potentialAction: {
          '@type': 'SearchAction',
          target: 'https://docs.tradejs.dev/?q={search_term_string}',
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@type': 'SoftwareApplication',
        name: 'TradeJS',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Linux, macOS, Windows',
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
        url: 'https://tradejs.dev',
        description:
          'Open-source trading strategy framework for TypeScript and Pine Script with backtesting, runtime execution, and AI/ML enrichment.',
      },
      {
        '@type': 'SoftwareSourceCode',
        name: 'TradeJS',
        codeRepository: 'https://github.com/tradejs-dev/tradejs',
        programmingLanguage: ['TypeScript', 'Pine Script'],
        runtimePlatform: 'Node.js',
        url: 'https://tradejs.dev',
        license: 'https://opensource.org/licenses/MIT',
        description:
          'Open-source framework for TypeScript and Pine Script trading strategies, with runtime execution, backtesting, and AI/ML enrichment.',
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <LandingPage />
    </>
  );
}
