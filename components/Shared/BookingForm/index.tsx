'use client'
import React, { useState } from 'react'
import { TabContext, TabList, TabPanel } from '@mui/lab';
import { Box, TextField, FormControlLabel, Button,
  Tab, Autocomplete, Grid, FormControl, Radio, RadioGroup, InputAdornment, MenuItem } from '@mui/material';
import { FlightTakeoffRounded, DateRange, Person } from '@mui/icons-material';
import Airports from '@/data/airports.json';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import moment from 'moment';
export interface BookingProps {
  formSelection: string;
  setFormSelection: any;
}

const BookingForm: React.FC<BookingProps> = ({formSelection, setFormSelection }) => {
  const [bookingOption, setBookingOption] = useState('Round-trip');
  const [fromDate, setFromDate]  = useState('');
  const [toDate, setToDate]  = useState('');
  const handleChange = (e: React.SyntheticEvent, newValue: string) => {
    setFormSelection(newValue);
  };

  const [bookingInfo, setBookingInfo] = useState<any>({
    departure: '',
    returning: '',
    persons: '1',
    cabinClass: ''
  });

  const bookFlight = async () => {
    let departureCode = bookingInfo.departure.split(" ")[0];
    let returningCode = bookingInfo.returning.split(" ")[0];

    window.location.href=`/ticket-booking?departure=${departureCode}&returning=${returningCode}&departureDate=${fromDate}&returningDate=${toDate}&persons=${bookingInfo.persons}`
  }

  return (
    <Box sx={{
        borderRadius: '1rem',
        backgroundColor: 'white',
        marginTop: 8,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        p: 1,
        width: '65vw'
      }}
    >
      <Box
        component="form"
        noValidate
        sx={{  width: '100%' }}
      >
      <TabContext value={formSelection}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', }}>
          <TabList onChange={handleChange} aria-label="Booking Options"
            sx={{
              display: 'flex',
              justifyContent: 'center',
              "& .MuiTab-root.Mui-selected": {
                color: '#FF0404'
              },
              "& .MuiTabs-flexContainer": {
                justifyContent: 'center',
              }
            }}
            TabIndicatorProps={{
              style: {
                backgroundColor: "#FF0404",
                color: "#FF0404",
              }
            }}
          >
            <Tab label="Flights" value="1" sx={{width: '35%', fontWeight: '600'}} />
            <Tab label="Hotels" value="2" sx={{width: '35%', fontWeight: '600'}} />
            <Tab label="Cars" value="3" sx={{width: '35%',  fontWeight: '600'}} />
          </TabList>
        </Box>
        <TabPanel value="1">
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <FormControl>
                <RadioGroup
                  row
                  onChange={(e) => setBookingOption(e.target.value)}
                  value={bookingOption}
                >
                  <FormControlLabel value="Round-trip" control={<Radio sx={{
                        '&, &.Mui-checked': {
                          color: '#FF0404',
                        },
                      }} />} label="Round-trip" />
                  <FormControlLabel value="One way" control={<Radio sx={{
                        '&, &.Mui-checked': {
                          color: '#FF0404',
                        },
                      }}/>} label="One way" />
                  <FormControlLabel value="Multi-city" control={<Radio sx={{
                        '&, &.Mui-checked': {
                          color: '#FF0404',
                        },
                      }}/>} label="Multi-city" />
                </RadioGroup>
              </FormControl>
            </Grid>

            <Grid item xs={6}>
              <Autocomplete
                freeSolo
                value={bookingInfo.departure}
                onChange={(e, value: any) => setBookingInfo({...bookingInfo, departure: value})}
                options={Airports.map((option) => `${option.iata_code} ${option.country} - ${option.city} - ${option.name} `)}
                renderInput={(params) => (
                  <TextField
                    {...params}

                    InputProps={{
                      ...params.InputProps,
                      startAdornment: (
                        <InputAdornment position="start">
                          <FlightTakeoffRounded sx={{ color: '#FF0404'}} />
                        </InputAdornment>
                      )
                    }}
                  label="Departing from?" />
                )}
              />
            </Grid>
            <Grid item xs={6}>
              <Autocomplete
                freeSolo
                value={bookingInfo.returning}
                onChange={(e, value: any) => setBookingInfo({...bookingInfo, returning: value})}
                options={Airports.map((option) => `${option.iata_code} ${option.country} - ${option.city} - ${option.name} `)}
                renderInput={(params) => (
                <TextField
                  {...params}
                  InputProps={{
                    ...params.InputProps,
                    startAdornment: (
                      <InputAdornment position="start">
                          <FlightTakeoffRounded sx={{ color: '#FF0404'}} />
                      </InputAdornment>
                    )
                  }}
                label="Going to?" />
                )}
              />
            </Grid>

            <Grid item xs={6}>
              <LocalizationProvider dateAdapter={AdapterDayjs}>
                <DatePicker
                  disablePast
                  label="Departing"
                  value={fromDate}
                  onChange={(newValue) => {
                    setFromDate(moment(newValue).format('YYYY-MM-DD'));
                  }}
                  renderInput={(params) => <TextField
                    fullWidth {...params}
                    InputProps={{
                      ...params.InputProps,
                      startAdornment: (
                        <InputAdornment position="start">
                          <DateRange sx={{ color: '#FF0404'}} />
                        </InputAdornment>
                      )
                    }}
                  />}
                />
              </LocalizationProvider>
            </Grid>
            <Grid item xs={6}>
              {bookingOption !== 'One way' ? (
                <LocalizationProvider dateAdapter={AdapterDayjs}>
                  <DatePicker
                    disablePast
                    label="Returning"
                    value={toDate}
                    onChange={(newValue) => {
                      setToDate(moment(newValue).format('YYYY-MM-DD'));
                    }}
                    renderInput={(params) =>
                    <TextField
                      fullWidth {...params}
                      InputProps={{
                        ...params.InputProps,
                        startAdornment: (
                          <InputAdornment position="start">
                            <DateRange sx={{ color: '#FF0404'}} />
                          </InputAdornment>
                        )
                      }}
                    />}
                  />
                </LocalizationProvider>
              ): null}
            </Grid>
            <Grid item xs={6}>
              <TextField
                onChange={(e) => setBookingInfo({...bookingInfo, persons: e.target.value})}
                type="number"
                label="Persons"
                fullWidth
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                        <Person sx={{ color: '#FF0404'}} />
                    </InputAdornment>
                  )
                }}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                onChange={(e) => setBookingInfo({...bookingInfo, cabinClass: e.target.value})}
                label="Cabin Class"
                fullWidth
                select
               >
                <MenuItem value="Economy">Economy</MenuItem>
                <MenuItem value="Business">Business</MenuItem>
                <MenuItem value="First Class">First Class</MenuItem>
                <MenuItem value="Premium Economy">Premium Economy</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12}>
              <Button
                onClick={bookFlight}
                fullWidth
                variant="contained"
                sx={{
                  ':hover': {
                    backgroundColor: '#FF0404',
                  },
                }}
                style={{
                  backgroundColor: '#FF0404'
                }}
              >
                Find your flight
              </Button>
            </Grid>
          </Grid>
        </TabPanel>
        <TabPanel value="2">
          <Box display="flex" justifyContent="center">
            <h3>Coming Soon</h3>
          </Box>

        </TabPanel>
        <TabPanel value="3">
          <Box display="flex" justifyContent="center">
            <h3>Coming Soon</h3>
          </Box>
        </TabPanel>
      </TabContext>
      </Box>
    </Box>
  )
}

export default BookingForm