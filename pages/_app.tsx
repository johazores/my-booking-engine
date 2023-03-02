import type { AppProps } from 'next/app';
import Head from 'next/head';
import '@/styles/globals.scss';
import { HasLayout } from '@/components/Shared/HasLayout';

function MyApp({ Component, pageProps }: AppProps) {
  const { getLayout } = Component as typeof Component & HasLayout;

  return (
    <div>
      <Head>

      </Head>
      {getLayout ? getLayout(<Component {...pageProps} />) : <Component {...pageProps} />}
    </div>
  );
}

export default MyApp;
