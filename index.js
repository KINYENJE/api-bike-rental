const express = require('express');
require('dotenv').config();
const { default: mongoose } = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const upload = multer({storage: multer.memoryStorage()}); // Use memory storage for file uploads
const fs = require('fs');
const Tesseract = require('tesseract.js');
const cloudinary = require('cloudinary').v2;

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const User = require('./models/userSchema');
const Bike = require('./models/bikeSchema');
const Booking = require('./models/bookingSchema');
// const Review = require('./models/reviewSchema');



const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors()); // Enable CORS for all routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


let connectionString = process.env.MONGODB_CONNECTION_STRING; 

// if (!connectionString) {
//   console.error('No connection string provided');
//   process.exit(1);
// } else {
//   console.log('Connection string provided');
// }

mongoose.connect(connectionString)
.then(() => {
  console.log('Connected to MongoDB');
}).catch((err) => {
  console.error('Error connecting to MongoDB', err);
  process.exit(1); 
});


cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

app.get('/', (req, res) => {
  res.send('Hello BIKEY World!');

  console.log('Hello World!');

});

app.post('/api/signup', upload.single('idPic'), async (req, res) => {
  try {
    // 1. OCR Verification
    const imageBuffer = req.file.buffer; // Get the file buffer from multer
    const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng');
    // Check if Kenyan ID keywords are present in the text
    const isKenyanID = /REPUBLIC OF KENYA|IDENTITY CARD|NATIONAL IDENTITY CARD/i.test(text);
    if (!isKenyanID) {
      console.error('Invalid ID:', text);
      return res.status(400).json({ message: 'Invalid ID.'});
      
    }
    console.log('OCR Text:', text);

    // Check if ID number matches the text
    if (!text.includes(req.body.idNumber)) {
      console.error('ID number does not match:', text);
      return res.status(400).json({ message: 'ID number does not match the ID picture.' });
      
    }

    // 2. Upload ID picture to Cloudinary
    const streamifier = require('streamifier');

    const uploadFromBuffer = (buffer) => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'idPics' },
          (error, result) => {
            if (result) resolve(result);
            else reject(error);
          }
        );
        streamifier.createReadStream(buffer).pipe(stream);
      });
    };

    const cloudinaryResult = await uploadFromBuffer(imageBuffer);
    const idPicUrl = cloudinaryResult.secure_url;
    console.log('ID picture uploaded to Cloudinary:', idPicUrl);


    // 3. Save user to MongoDB
    const hashedPassword = await bcrypt.hashSync(req.body.password, 10);
    const user = new User({
      username: req.body.username,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      phone: req.body.phone,
      idNumber: req.body.idNumber,
      idPic: idPicUrl,
      isOwner: req.body.isOwner,
      email: req.body.email,
      password: hashedPassword,
    });
    await user.save();


    res.status(200).json({ status: 'ok', message: 'User created', user });
  } catch (err) {
    res.status(400).json({ message: 'Error', err });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const user = await User.findOne({ email: req
      .body.email });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const passwordIsValid = bcrypt.compareSync(req.body.password, user.password);

    if (!passwordIsValid) {
      return res.status(401).json({
        message: 'Invalid password',
      });
    } else{

      const token = jwt.sign({
         id: user._id,
         email: user.email,
         phone: user.phone,
         idNo: user.idNumber,
         isOwner: user.isOwner 
        },
         process.env.SECRET, 
        {
        expiresIn: 86400, // 24 hours
      });
      res.status(200).json({ status: 'ok', message: 'User logged in', token });
    }
  } catch (err) {
    res.status(400).json({ message: 'Error', err });
  }
});

app.get('/api/check-user', async (req, res) => {
  const { email } = req.query;
  if (!email) {
    return res.status(400).json({ exists: false, message: "No email provided" });
  }
  const user = await User.findOne({ email });
  if (user) {
    res.json({
      exists: true,
      user: {
        isOwner: user.isOwner,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        idPic: user.idPic
      }
    });
  } else {
    res.json({ exists: false });
  }
});

app.put('/api/booking/:id', async (req, res) => {
  const bookingId = req.params.id;
  const status = req.body.status;
  console.log(status);
  console.log(bookingId);

  // const accessToken = req.headers['authorization'].split(' ')[0];

  try {
    const booking = await Booking.findOneAndReplace({ _id: bookingId }, { status });

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    } else {
      console.log(booking);
    }

   
    res.status(200).json({ status: 'ok', message: 'Booking updated', booking });
  } catch (err) {
    res.status(400).json({ message: 'Error', err });
  }
}); 

app.get('/api/bookings', async (req, res) => {
  const accessToken = req.headers['authorization'].split(' ')[0];

  if (!accessToken) {
    return res.status(403).json({ message: 'No token provided' });
  } else {
    jwt.verify(accessToken, process.env.SECRET, async (err, decoded) => {
      if (err) {
        return res.status(401).json({ message: 'Unauthorized' });
      } else {
        const user = await User.findOne({ email: decoded.email });
        const bookings = await Booking.find({ user: user._id });
        res.status(200).json({ status: 'ok', bookings });
      }
    });
  }
});



app.post('/api/booking', async (req, res) => {
  console.log(req.body);
  const startTime = req.body.startTime;
  const endTime = req.body.endTime;
  const bikeId = req.body.bikeId;
  const bikeType = req.body.bikeType;
  const bikeLocation = req.body.bikeLocation;
  const price = req.body.finalPrice;
  const bikeOwner = req.body.bikeOwner;
  

 // if bikeid is not in the database update the database with the bikeid and bikeowner and bike location and bike type
  try {
    const bike = await Bike.findOne ({ _uuid : bikeId });
    if (!bike) {
      const bike = new Bike(
        {
          _uuid: bikeId,
          owner: bikeOwner,
          location: bikeLocation,
          type: bikeType
        }
      );
      await bike.save();
    } else {
      console.log("Bike already exists");
    }
  } catch (err) {
    res.status(400).json({ message: 'Error', err });
  }


  
  


  const accessToken = req.headers['authorization'].split(' ')[0];
  console.log(accessToken);

  if (!accessToken) {
    return res.status(403).json({ message: 'No token provided' });
  } else {
    jwt.verify(accessToken, process.env.SECRET, async (err, decoded) => {
      if (err) {
        return res.status(401).json({ message: 'Unauthorized' });
      } else {
        const user = await User.findOne({ email: decoded.email });
        const booking = new Booking(
          {
            user: user._id,
            customerEmail: user.email,
            bikeId,
            bikeOwner,
            bikeType,
            bikeLocation,
            startTime,
            endTime,
            price,
            
          }
        );
        await booking.save();
        res.status(200).json({ status: 'ok', message: 'Booking created', booking });
      }
    });
  }
  
});

app.get('/api/userdata', async (req, res) => {
  const accessToken = req.headers['authorization'].split(' ')[0];

  console.log(accessToken);

  if (!accessToken) {
    return res.status(403).json({ message: 'No token provided' });
  } else {
    jwt.verify(accessToken, process.env.SECRET, async (err, decoded) => {
      if (err) {
        return res.status(401).json({ message: 'Unauthorized' });
      } else {
        const user = await User.findOne({ email: decoded.email });
        console.log(user);
        res.status(200).json({ status: 'ok', user });
      }
    });
  }
});
  



app.listen(PORT, () => {
  console.log(`Example app listening at http://localhost:${PORT}`);
});