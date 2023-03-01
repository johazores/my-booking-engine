import { NextApiHandler } from 'next';

const handler: NextApiHandler = async (req, res) => {

  if(!req.query.name) {
    res.status(400).json({ message: 'Name Parameter is Required'});
    return;
  }

  const config = {
    method: 'GET',
    headers: {
      'X-RapidAPI-Key': `${process.env.RAPID_API_KEY}`,
      'X-RapidAPI-Host': `${process.env.RAPID_API_HOST}`
    }
  };

 await fetch(`https://${process.env.RAPID_API_HOST}/airports/search?query=${req.query.name}`, config)
    .then(response => response.json())
    .then(response => {
      res.status(200).json(response);
    })
    .catch(err => {
      res.status(500).json({ err: err });
      console.error(err)
    });

  return;
};

export default handler;
