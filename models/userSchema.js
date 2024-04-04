const mongoose = require('mongoose');
const { Schema } = mongoose;

const userSchema = new Schema({
  username: {
    type: String,
    required: [true, 'Username is required'],
    lowercase: true,
  },
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    lowercase: true,
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    lowercase: true,
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    unique: true,
    minlength: [5, 'Email must be at least 5 characters'],
    validate: {
      validator: function (v) {
        return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v); // email regex pattern {2,} means at least 2 characters
      },
      message: (props) => `${props.value} is not a valid email address!`,
    },
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    validate: {
      validator: function (v) {
        return /^[0-9]{10}$/.test(v); // 10 digits phone number {10} means exactly 10 characters and all digits {0-9 only}
      },
      message: (props) => `${props.value} is not a valid phone number!`,
    },
  },
  idNumber: {
    type: String,
    required: [true, 'ID number is required'],
    // validate: {
    //   validator: function (v) {
    //     return /^[0-9]{8}$/.test(v); // 8 digits ID number {8} means exactly 8 characters
    //   },
    //   message: (props) => `${props.value} is not a valid ID number!`,
    // },
  },
  idPic: {
    type: String,
    default: 'https://via.placeholder.com/150',
  },
  isOwner: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true }, { collection: 'users' });

const User = mongoose.model('User', userSchema);

module.exports = User;