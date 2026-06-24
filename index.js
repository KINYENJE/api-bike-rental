const express = require('express');
require('dotenv').config();
const { default: mongoose } = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const upload = multer({storage: multer.memoryStorage()}); // Use memory storage for file uploads
const fs = require('fs');
const Tesseract = require('tesseract.js');
const { createWorker } = require('tesseract.js');
const cloudinary = require('cloudinary').v2;

const nodemailer = require('nodemailer');
const crypto = require('crypto');

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const User = require('./models/userSchema');
const Bike = require('./models/bikeSchema');
const Booking = require('./models/bookingSchema');
// const Review = require('./models/reviewSchema');

const cron = require('node-cron');
const { createClient } = require('@sanity/client');

const sanityClient = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: process.env.SANITY_DATASET,
  apiVersion: '2024-01-01',
  useCdn: false,
});

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors()); // Enable CORS for all routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/tesseract', express.static('public/tesseract'));


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


// nodemailer transporter setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// // Run every 5 minutes
// cron.schedule('*/5 * * * *', async () => {
//   const now = new Date();
//   // Find all bookings that have ended but are still marked as active
//   const expiredBookings = await Booking.find({ endTime: { $lt: now }, status: 'active' });
//   for (const booking of expiredBookings) {
//     booking.status = 'completed';
//     await booking.save();
//     // Optionally, update the bike's availability if you track it in the Bike model
//     await Bike.findByIdAndUpdate(booking.bikeId, { available: true });
//   }
//   console.log('Checked and updated expired bookings');
// });


app.post('/api/cron', async (req, res) => {
  try {
    const now = new Date();
    const expiredBookings = await Booking.find({ endTime: { $lt: now }, status: 'active' });
    for (const booking of expiredBookings) {
      booking.status = 'completed';
      await booking.save();
      await Bike.findByIdAndUpdate(booking.bikeId, { available: true });
    }
    res.status(200).json({ message: 'Cron job executed successfully.' });
  } catch (err) {
    console.error('Cron job error:', err);
    res.status(500).json({ message: 'Cron job failed.' });
  }
});

// Request password reset
app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour expiry

    // Save token and expiry to user
    user.resetToken = resetToken;
    user.resetTokenExpiry = resetTokenExpiry;
    await user.save();

    // Send reset email
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'BIKEY Password Reset Request',
      html: `
        <h2>Password Reset Request</h2>
        <p>Click the link below to reset your password:</p>
        <a href="${resetLink}">Reset Password</a>
        <p>This link expires in 1 hour.</p>
      `,
    };
    await transporter.sendMail(mailOptions);

    res.status(200).json({ status: 'ok', message: 'Reset link sent to your email.' });
  } catch (error) {
    console.error('Error in forgot-password:', error);
    res.status(500).json({ message: 'Internal server error', error });
  }
});


// Reset password
app.post('/api/reset-password', async (req, res) => {
  try {
    const {  token, password } = req.body;
    const user = await User.findOne({
      resetToken: token,
      resetTokenExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // Hash new password and save
    const hashedPassword = await bcrypt.hash(password, 10);
    user.password = hashedPassword;
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();

    res.status(200).json({ status: 'ok', message: 'Password has been reset successfully' });
  } catch (error) {
    console.error('Error in reset-password:', error);
    res.status(500).json({ message: 'Internal server error', error });
  }
});


app.get('/', (req, res) => {
  res.send('Hello BIKEY World!');

  console.log('Hello World!');

});

// app.post('/api/signup', upload.single('idPic'), async (req, res) => {
//   console.log('Received signup request:', req.body);
//   console.log('Received file:', req.file ? req.file.originalname : 'No file uploaded');

//   const worker = await createWorker({
//     corePath: `${process.env.API_URL}/tesseract/tesseract-core-simd.wasm.js`,
//     workerPath: `${process.env.API_URL}/tesseract/worker.min.js`,
//     langPath: `https://tessdata.projectnaptha.com/4.0.0_best`, // or your own if you want
//   });

//   try {
//     // 1. OCR Verification
//     const imageBuffer = req.file.buffer; // Get the file buffer from 
//     await worker.load();
//     await worker.loadLanguage('eng');
//     await worker.initialize('eng');
//     const { data: { text } } = await worker.recognize(imageBuffer);
//     await worker.terminate();
//     // Check if Kenyan ID keywords are present in the text
//     const isKenyanID = /REPUBLIC OF KENYA|IDENTITY CARD|NATIONAL IDENTITY CARD/i.test(text);
//     if (!isKenyanID) {
//       console.error('Invalid ID:', text);
//       return res.status(400).json({ message: 'Invalid ID.'});
      
//     }
//     console.log('OCR Text:', text);

//     // Check if ID number matches the text
//     if (!text.includes(req.body.idNumber)) {
//       console.error('ID number does not match:', text);
//       return res.status(400).json({ message: 'ID number does not match the ID picture.' });
      
//     }

//     // 2. Upload ID picture to Cloudinary
//     const streamifier = require('streamifier');

//     const uploadFromBuffer = (buffer) => {
//       return new Promise((resolve, reject) => {
//         const stream = cloudinary.uploader.upload_stream(
//           { folder: 'idPics' },
//           (error, result) => {
//             if (result) resolve(result);
//             else reject(error);
//           }
//         );
//         streamifier.createReadStream(buffer).pipe(stream);
//       });
//     };

//     const cloudinaryResult = await uploadFromBuffer(imageBuffer);
//     const idPicUrl = cloudinaryResult.secure_url;
//     console.log('ID picture uploaded to Cloudinary:', idPicUrl);


//     // 3. Save user to MongoDB
//     const hashedPassword = req.body.password
//       ? await bcrypt.hashSync(req.body.password, 10)
//       : undefined;
//     const user = new User({
//       username: req.body.username,
//       firstName: req.body.firstName,
//       lastName: req.body.lastName,
//       phone: req.body.phone,
//       idNumber: req.body.idNumber,
//       idPic: idPicUrl,
//       isOwner: req.body.isOwner,
//       email: req.body.email,
//       password: hashedPassword,
//     });
//     await user.save();


//     res.status(200).json({ status: 'ok', message: 'User created', user });
//   } catch (err) {
//     res.status(400).json({ message: 'Error', err });
//   }
// });

app.post('/api/signup', upload.single('idPic'), async (req, res) => {
  console.log('Received signup request:', req.body);
  try {
    const existingUser = await User.findOne({ email: req.body.email });

    // OCR Verification using OCR.space instead of Tesseract
    const imageBuffer = req.file.buffer;
    console.log('Image buffer received:', imageBuffer.length, 'bytes');

    // Create FormData for OCR.space - using FormData instead of base64
    const formData = new URLSearchParams();
    formData.append('apikey', 'helloworld');
    formData.append('language', 'eng');
    formData.append('isOverlayRequired', 'false');
    formData.append('scale', 'true');
    formData.append('OCREngine', '2'); // More accurate engine
    
    // Convert buffer to base64 with explicit image type
    const base64Image = imageBuffer.toString('base64');
    formData.append('base64Image', `data:image/jpeg;base64,${base64Image}`);

    // Call OCR.space API
    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData
    });
    
    const ocrResult = await response.json();
    console.log('OCR Result:', ocrResult);
    
    if (ocrResult.IsErroredOnProcessing || !ocrResult.ParsedResults || ocrResult.ParsedResults.length === 0) {
      console.error('OCR Error:', ocrResult);
      return res.status(400).json({ message: 'Failed to read ID card text. Please try again with a clearer image.' });
    }
    
    const text = ocrResult.ParsedResults[0].ParsedText;
    console.log('OCR Text:', text);

    // Normalize for better matching
    const normalizedText = text.replace(/\s+/g, '').toLowerCase();
    const normalizedId = req.body.idNumber.replace(/\s+/g, '').toLowerCase();

    // Check if Kenyan ID keywords are present
    const isKenyanID = /republicofkenya|identitycard|nationalidentitycard/i.test(normalizedText);
    if (!isKenyanID) {
      return res.status(400).json({ message: 'Invalid ID.' });
    }

    // Check if ID number matches the text
    if (!normalizedText.includes(normalizedId)) {
      return res.status(400).json({ message: 'ID number does not match the ID picture.' });
    }

    // Upload ID picture to Cloudinary
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

    // If user exists and has no idPic, update their record
    if (existingUser && !existingUser.idPic) {
      existingUser.idPic = idPicUrl;
      existingUser.idNumber = req.body.idNumber;
      // Optionally update other fields if needed
      await existingUser.save();
      return res.status(200).json({ status: 'ok', message: 'ID picture uploaded, registration completed', user: existingUser });
    }

    // If user exists and already has idPic, block signup
    if (existingUser && existingUser.idPic) {
      return res.status(400).json({ message: 'Email already registered.' });
    }

    // --- Normal signup for new users ---
    const hashedPassword = req.body.password
      ? await bcrypt.hashSync(req.body.password, 10)
      : undefined;

    const user = new User({
      username: req.body.username,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      phone: req.body.phone || '',
      idNumber: req.body.idNumber || '',
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
      console.log(user);

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
        idPic: user.idPic,
        phone: user.phone,
        idNumber: user.idNumber,
      }
    });
  } else {
    res.json({ exists: false });
  }
});

app.put('/api/user', async (req, res) => {
  const email = req.query.email;
  const { firstName, lastName, phone } = req.body;

  if (!email) {
    return res.status(400).json({ status: 'error', message: 'No email provided' });
  }

  try {
    const updates = {};
    if (firstName !== undefined) updates.firstName = firstName;
    if (lastName !== undefined) updates.lastName = lastName;
    if (phone !== undefined) updates.phone = phone;

    const user = await User.findOneAndUpdate(
      { email },
      updates,
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    res.status(200).json({
      status: 'ok',
      message: 'Profile updated successfully',
      user: {
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        idNumber: user.idNumber,
        idPic: user.idPic,
        isOwner: user.isOwner,
      },
    });
  } catch (err) {
    // Surface mongoose validation errors (e.g. invalid phone) to the client
    if (err.name === 'ValidationError') {
      const message = Object.values(err.errors).map((e) => e.message).join(', ');
      return res.status(400).json({ status: 'error', message });
    }
    console.error('Update profile error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error.' });
  }
});

app.delete('/api/booking/:id', async (req, res) => {
  const bookingId = req.params.id;

  try {
    const booking = await Booking.findByIdAndDelete(bookingId);

    if (!booking) {
      return res.status(404).json({ status: 'error', message: 'Booking not found' });
    }

    res.status(200).json({ status: 'ok', message: 'Booking cancelled', booking });
  } catch (err) {
    console.error('Cancel booking error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error.' });
  }
});

app.get('/api/bookings', async (req, res) => {
 const email = req.query.email;
 
 try {
  let user = await User.findOne({ email });
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }
  const bookings = await Booking.find({ user: user._id });
  console.log(bookings);
  res.status(200).json({ status: 'ok', bookings, message: 'Bookings fetched successfully' });
 } catch (err) {
  res.status(400).json({ message: 'Error', err });
  console.log(err);
 }

 
});



app.post('/api/booking', async (req, res) => {
  try {
    const { startTime, endTime, bikeId, bikeType, bikeOwner, bikeLocation } = req.body;
    const email = req.query.email;

    if (!startTime || !endTime || !bikeId || !email) {
      return res.status(400).json({ status: 'error', message: 'Missing required fields.' });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (end <= start) {
      return res.status(400).json({ status: 'error', message: 'End time must be after start time.' });
    }

    // Fetch authoritative price from Sanity — never trust client-submitted price
    const bike = await sanityClient.fetch(
      `*[_type == "bike" && _id == $bikeId][0]{ price }`,
      { bikeId }
    );
    if (!bike || bike.price == null) {
      return res.status(404).json({ status: 'error', message: 'Bike not found or has no price set.' });
    }

    const hours = (end - start) / 1000 / 60 / 60;
    const calculatedPrice = bike.price * hours;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found. Please sign up first.' });
    }

    // Check for overlapping bookings
    const overlappingBooking = await Booking.findOne({
      bikeId,
      $or: [
        { startTime: { $lt: end, $gte: start } },
        { endTime: { $gt: start, $lte: end } },
        { startTime: { $lte: start }, endTime: { $gte: end } }
      ]
    });

    if (overlappingBooking) {
      return res.status(400).json({ status: 'error', message: 'Bike is already booked for the selected time.' });
    }

    const booking = new Booking({
      user: user._id,
      bikeId,
      bikeType,
      bikeOwner,
      bikeLocation,
      startTime: start,
      endTime: end,
      price: calculatedPrice,
      status: 'active'
    });

    await booking.save();

    const formattedStartTime = start.toLocaleString();
    const formattedEndTime = end.toLocaleString();

    // Send email to user
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Bike Booking Confirmation',
      html: `
        <h2>Booking Confirmed!</h2>
        <p>You have successfully booked a bike.</p>
        <ul>
          <li><strong>Bike Owner:</strong> ${bikeOwner.name || bikeOwner}</li>
          <li><strong>Booking Time:</strong> ${formattedStartTime} to ${formattedEndTime}</li>
          <li><strong>Location:</strong> ${bikeLocation}</li>
          <li><strong>Price:</strong> KSh ${calculatedPrice.toFixed(2)}</li>
        </ul>
      `
    });

    // Send email to bike owner
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: 'testingjim232@gmail.com' || bikeOwner.email,
      subject: 'Your Bike Has Been Booked',
      html: `
        <h2>Your bike has been booked!</h2>
        <ul>
          <li><strong>User Name:</strong> ${user.name || ''}</li>
          <li><strong>User Email:</strong> ${user.email}</li>
          <li><strong>User Phone:</strong> ${user.phone || ''}</li>
          <li><strong>Booking Time:</strong> ${formattedStartTime} to ${formattedEndTime}</li>
          <li><strong>Location:</strong> ${bikeLocation}</li>
          <li><strong>Price:</strong> KSh ${calculatedPrice.toFixed(2)}</li>
        </ul>
      `
    });

    res.status(200).json({ status: 'ok', message: 'Booking successful', booking });
  } catch (err) {
    console.error('Booking error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error.' });
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