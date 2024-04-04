const { Timestamp } = require('mongodb');
const mongoose = require('mongoose');
const { Schema } = mongoose;

const bookingSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User is required'],
  },
  bikeId: {
    // type: Schema.Types.ObjectId,
    // ref: 'Bike',
    type: String,
    required: [true, 'Bike ID is required'],
  },
  bikeOwner: {
    type: String,
    required: [true, 'Bike owner is required'],
  },
  bikeType: {
    type: String,
    required: [true, 'Bike type is required'],
  },
  bikeLocation: {
    type: String,
    required: [true, 'Bike location is required'],
  },
  price: {
    type: Number,
    required: [true, 'Price is required'],
  },
  startTime: {
    type: Date,
    required: [true, 'Start time is required'],
  },
  endTime: {
    type: Date,
    required: [true, 'End time is required'],
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
}, { timestamps: true }, { collection: 'bookings' });

const Booking = mongoose.model('Booking', bookingSchema);

module.exports = Booking;