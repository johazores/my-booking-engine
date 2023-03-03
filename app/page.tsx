'use client'
import { useState } from 'react'
import BookingForm from "@/components/Shared/BookingForm";

export default function Home() {
  const [formSelection, setFormSelection] = useState('1');
  const renderBgTitles = (value: string) => {
    switch(value){
      case '2':
        return {
          image: `background-image-2`,
          h1: 'Flight rooms at lowest possible rates!'
        }
      default:
        return {
          image: `background-image-1`,
          h1: 'Flight tickets at lowest possible rates!'
        }
    }
  }
  const getContent = renderBgTitles(formSelection);

  return (
    <div className={`w-full h-full bg-no-repeat bg-cover bg-center ${getContent?.image}`}>
      <div className="h-full flex items-center flex-col">
        <div className="flex items-center flex-col mt-16">
          <h1 className="text-white text-3xl">{getContent?.h1}</h1>
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
