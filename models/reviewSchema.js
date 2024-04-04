const mongoose = require('mongoose');
const { Schema } = mongoose;

const reviewSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User is required'],
  },
  bikeId: {
    type: Schema.Types.ObjectId,
    ref: 'Bike',
    required: [true, 'Bike ID is required'],
  },
  rating: {
    type: Number,
    required: [true, 'Rating is required'],
    min: [1, 'Rating must be at least 1'],
    max: [5, 'Rating must be at most 5'],
  },
  comment: {
    type: String,
    required: [true, 'Comment is required'],
  },
}, { timestamps: true }, { collection: 'reviews' });

const Review = mongoose.model('Review', reviewSchema);

module.exports = Review;