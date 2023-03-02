import React from 'react'
import asyncComponent from '@/utils/types/hack';
export interface TicketBookingProps {
  searchParams: any;
  data: any;
}

const TicketBooking = asyncComponent(async ({ searchParams }: TicketBookingProps ) => {
  console.log(searchParams);

  return (
    <div className="grid grid-cols-12">
      <div className="col-span-3">
        Other Options
      </div>
      <div className="col-span-6">
        <p>Test</p>
      </div>
      <div className="col-span-3">
        Ads Here
      </div>
    </div>
  );
});

export default TicketBooking