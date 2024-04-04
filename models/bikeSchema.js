const mongoose = require('mongoose');
const { Schema } = mongoose;

const bikeSchema = new Schema({
  _uuid: {
    type: String,
    required: [true, 'Bike name is required'],
    lowercase: true,
  },
  owner: {
    type: String,
    required: [true, 'Owner is required'],
  },
  type: {
    type: String,
    required: [true, 'Bike type is required'],
    lowercase: true,
  },
  location: {
    type: String,
    required: [true, 'Bike location is required'],
    lowercase: true,
  },
 
}, { timestamps: true }, { collection: 'bikes' });

const Bike = mongoose.model('Bike', bikeSchema);

module.exports = Bike;