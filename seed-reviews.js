// Seeds dummy reviews for every bike in Sanity.
// Run with:  npm run seed:reviews
//
// Safe to re-run: it clears existing reviews first so you don't get duplicates.

require('dotenv').config();
const mongoose = require('mongoose');
const { createClient } = require('@sanity/client');
const Review = require('./models/reviewSchema');

const sanityClient = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: process.env.SANITY_DATASET,
  apiVersion: '2024-01-01',
  useCdn: false,
});

const REVIEWERS = [
  'Brian Otieno', 'Aisha Mohamed', 'Kevin Njoroge', 'Wanjiku Kamau',
  'David Mwangi', 'Faith Achieng', 'Samuel Kiptoo', 'Mercy Wairimu',
  'John Kariuki', 'Lydia Nduta', 'Peter Omondi', 'Grace Muthoni',
];

const COMMENTS_BY_RATING = {
  5: [
    'Absolutely loved this bike! Smooth ride and well maintained.',
    'Perfect for my weekend trip. Owner was super helpful.',
    'Best rental experience so far. Highly recommend!',
    'Clean, fast and reliable. Will book again.',
  ],
  4: [
    'Great bike, just a little scratch but rode perfectly.',
    'Really good value for the price. Comfortable ride.',
    'Solid bike and easy pickup. Would rent again.',
    'Enjoyed it a lot, brakes could be slightly better.',
  ],
  3: [
    'Decent ride, nothing special but got the job done.',
    'It was okay. Tyres felt a bit worn.',
    'Average experience, but the owner was friendly.',
  ],
  2: [
    'The gears were a bit stiff, not my favourite.',
    'Bike was usable but needed some maintenance.',
  ],
};

const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Weighted towards higher ratings so averages look realistic.
const randomRating = () => randomItem([5, 5, 5, 4, 4, 4, 3, 3, 2]);

async function seed() {
  if (!process.env.MONGODB_CONNECTION_STRING) {
    throw new Error('MONGODB_CONNECTION_STRING is not set in .env');
  }

  await mongoose.connect(process.env.MONGODB_CONNECTION_STRING);
  console.log('Connected to MongoDB');

  const bikes = await sanityClient.fetch(`*[_type == "bike"]{ _id, owner }`);
  console.log(`Found ${bikes.length} bikes in Sanity`);

  if (bikes.length === 0) {
    console.log('No bikes found — nothing to seed.');
    await mongoose.disconnect();
    return;
  }

  await Review.deleteMany({});
  console.log('Cleared existing reviews');

  const docs = [];
  const usedNames = new Set();

  for (const bike of bikes) {
    const numReviews = randomInt(2, 5);
    usedNames.clear();

    for (let i = 0; i < numReviews; i++) {
      // avoid the same reviewer twice on one bike
      let name = randomItem(REVIEWERS);
      let guard = 0;
      while (usedNames.has(name) && guard < 10) {
        name = randomItem(REVIEWERS);
        guard++;
      }
      usedNames.add(name);

      const rating = randomRating();
      docs.push({
        bikeId: bike._id,
        userName: name,
        userEmail: `${name.split(' ')[0].toLowerCase()}@example.com`,
        rating,
        comment: randomItem(COMMENTS_BY_RATING[rating]),
      });
    }
  }

  await Review.insertMany(docs);
  console.log(`Inserted ${docs.length} dummy reviews across ${bikes.length} bikes`);

  await mongoose.disconnect();
  console.log('Done.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
