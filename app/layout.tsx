import Header from '@/components/Shared/Header';
import Sidebar from '@/components/Shared/Sidebar';
import '@/styles/globals.scss';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <Header />
        <main className="flex w-full h-full">
          <Sidebar />
            {children}
        </main>
      </body>
    </html>
  )
}
