import Header from '@/components/Shared/Header';
import Sidebar from '@/components/Shared/Sidebar';
import '@/styles/globals.scss';
import Script from 'next/script';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <Header />
        <main className="w-full h-full">
          <div className="grid grid-cols-12 h-[100vh] pt-[55px]">
            <div className="col-span-2">
              <Sidebar />
            </div>
            <div className="col-span-10">
              {children}
            </div>
          </div>
        </main>
        <Script src="https://use.fontawesome.com/releases/v5.15.4/js/all.js" />
      </body>
    </html>
  )
}
