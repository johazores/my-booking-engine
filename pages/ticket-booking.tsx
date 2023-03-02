import { HasLayout } from '@/components/Shared/HasLayout'
import { NextPage } from 'next'
import React from 'react'
import Layout from '@/components/Shared/Layout';

const TicketBooking: NextPage & HasLayout = (props) => {
  console.log(props);
  return (
    <div className="grid grid-cols-12">
      <div className="col-span-3">
        Other Options
      </div>
      <div className="col-span-6">
        <p>

        </p>
      </div>
      <div className="col-span-3">
        Ads Here
      </div>
    </div>
  )
}

export async function getServerSideProps(context: any) {
  // console.log(context.query);
  const res = await fetch(`https://skyscanner44.p.rapidapi.com/search-extended`)
  const data = await res.json();

  return {
    props: { data }, // will be passed to the page component as props
  }
}

TicketBooking.getLayout = (page) => <Layout>{page}</Layout>;
export default TicketBooking;