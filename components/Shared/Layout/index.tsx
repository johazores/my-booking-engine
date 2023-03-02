import { ReactNode } from 'react';
import { RFC } from '@/utils/types/FCWithChildren';
import Sidebar from '@/components/Shared/Sidebar';
import Header from '@/components/Shared/Header';

interface LayoutProps {
  children: ReactNode;
}

const Layout: RFC<LayoutProps> = ({ children }) => {
  return (
    <>
      <Header />
        <main className="w-full h-full">
          <div className="grid grid-cols-12 h-[100vh] pt-[55px]">
            {/* // Will implement this on real work */}
            {/* <div className="col-span-12 lg:col-span-2 bg-[#E9E9E9]">
              <Sidebar />
            </div> */}
            <div className="col-span-12 lg:col-span-12">
              {children}
            </div>
          </div>
      </main>
    </>
  );
};

export default Layout;
