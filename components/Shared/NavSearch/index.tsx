import React from 'react';

const NavSearch = () => {

  return (
    <div className="flex flex-start w-80 relative h-[35px] bg-gray-200 items-center rounded">
      <div className="flex -mr-px justify-center w-15">
        <span
          className="flex items-center leading-normal bg-gray-200 px-2 border-0 rounded rounded-r-none text-2xl text-gray-600"
        >
          <i className="fas fa-user-circle opacity-20"></i>
        </span>
      </div>
      <input
        type="text"
        className="bg-gray-200 flex-shrink flex-grow leading-normal w-px flex-1 border-0 h-[35px] border-grey-light rounded rounded-l-none px-2 self-center relative text-base outline-none"
        placeholder="Search"
      />
    </div>
  )
}

export default NavSearch;