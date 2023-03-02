'use client'
import { useState } from 'react'
import BookingForm from "@/components/Shared/BookingForm";

export default function Home() {
  const [formSelection, setFormSelection] = useState('1');
  return (
    <div className="w-full h-full bg-[url('/images/flight-search.png')] bg-no-repeat bg-cover bg-center">
      <div className="h-full flex items-center flex-col">
        <div className="flex items-center flex-col mt-16">
          <h1 className="text-white text-3xl">Flight tickets at lowest possible rates!</h1>
          <h3 className="text-white">Our prices are the cheapest available anywhere in the world</h3>
          <BookingForm
            formSelection={formSelection}
            setFormSelection={setFormSelection}
          />
        </div>
      </div>
    </div>
  )
}
