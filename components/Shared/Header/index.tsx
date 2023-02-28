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
      <div className="shadow-md h-[55px] flex items-center pl-6 pr-6">
        <div className="w-96">
          <Link href="/">
            <Image
              width={126}
              height={50}
              src="/images/vm-logo.png"
              alt="Logo"
            />
          </Link>
        </div>
        <div className="flex w-full justify-between">
          <NavSearch />
          <div className="flex">
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