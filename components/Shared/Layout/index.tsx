import { ReactNode } from 'react';
import { RFC } from '@/utils/types/FCWithChildren';
import Header from '@/components/Shared/Header';

interface LayoutProps {
  children: ReactNode;
}

const Layout: RFC<LayoutProps> = ({ children }) => (
  <>
    <Header />
    <div className="min-h-screen bg-gray-50 pt-[55px]">{children}</div>
  </>
);

export default Layout;
