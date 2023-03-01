import { NextApiHandler } from 'next';

const handler: NextApiHandler = async (req, res) => {

  try {

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

    const response = await fetch(`https://${process.env.RAPID_API_HOST}/airports/search?query=${req.query.name}`, config);
    const data = await response.json();

    res.status(200).json(data);

  } catch(err) {
    res.status(500).json(err);
    console.error(err);
  }

  return;
};

export default handler;
