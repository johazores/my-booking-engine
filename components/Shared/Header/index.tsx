import Image from 'next/image';
import Link from 'next/link';
import React from 'react'
import NavSearch from '@/components/Shared/NavSearch';
import { NavItems } from './constants';
import { Home, ShoppingCart, Events, DownArrow,
  Notification, TicketBooking } from '@/components/Icons';

const Header = () => {
  const renderLogo = (icon: string) => {
    switch(icon){
      case 'Home':
        return <Home />;
      case 'Shopping':
        return <ShoppingCart />;
      case 'Events & Shows':
        return <Events />;
      case 'Notification':
        return <Notification />;
      case 'Ticket Booking':
        return <TicketBooking />;
      default:
        return;
    }
  }
  return (
    <header className="fixed w-full bg-white">
      <div className="grid grid-cols-12 h-[55px] shadow-md">
        <div className="col-span-2 flex items-center justify-start">
          <div className="pl-6">
            <Link href="/">
              <Image
                width={126}
                height={50}
                src="/images/vm-logo.png"
                alt="Logo"
              />
            </Link>
          </div>
        </div>
        <div className="col-span-4 flex items-center justify-start">
          <NavSearch />
        </div>
        <div className="col-span-6 flex items-center justify-end">
          <div className="flex items-center pr-6">
            {NavItems.map((item, index) => {
              const menuIdx = index;
              return (
                <a
                  className="pl-3 pr-3 text-xs flex items-center justify-center flex-col
                  hover:text-[#FF0404]
                  [&:hover_svg]:fill-[#FF0404]"
                  key={menuIdx}
                  href={item.link}>
                  {renderLogo(item.name)}
                  {item.name}
                </a>
              )
            })}
            <div className="flex items-center ml-6">
              <Image
                width={40}
                height={40}
                className="mr-2"
                src="/images/user.png"
                alt="Logo"
              />
              <DownArrow />
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}

export default Header;