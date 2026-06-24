const mongoose = require('mongoose');
const { Schema } = mongoose;

const reviewSchema = new Schema({
  // Sanity bike document _id (stored as a string, like bookings)
  bikeId: {
    type: String,
    required: [true, 'Bike ID is required'],
  },
  userName: {
    type: String,
    required: [true, 'Reviewer name is required'],
  },
  userEmail: {
    type: String,
  },
  rating: {
    type: Number,
    required: [true, 'Rating is required'],
    min: [1, 'Rating must be at least 1'],
    max: [5, 'Rating must be at most 5'],
  },
  comment: {
    type: String,
  },
}, { timestamps: true }, { collection: 'reviews' });

const Review = mongoose.model('Review', reviewSchema);

module.exports = Review;
