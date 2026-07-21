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
const Booking = require('./models/bookingSchema');
const Review = require('./models/reviewSchema');
const Payment = require('./models/paymentSchema');

const payments = require('./services/payments');

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

// Sends the booking confirmation emails (to renter + owner). Called after a
// payment is confirmed, not at booking time.
async function sendBookingEmails(booking, user) {
  const formattedStartTime = new Date(booking.startTime).toLocaleString();
  const formattedEndTime = new Date(booking.endTime).toLocaleString();
  const price = Number(booking.price).toFixed(2);

  // Email to renter
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: user.email,
    subject: 'Bike Booking Confirmed & Paid',
    html: `
      <h2>Booking Confirmed!</h2>
      <p>Your payment was received and your booking is confirmed.</p>
      <ul>
        <li><strong>Bike Owner:</strong> ${booking.bikeOwner}</li>
        <li><strong>Booking Time:</strong> ${formattedStartTime} to ${formattedEndTime}</li>
        <li><strong>Location:</strong> ${booking.bikeLocation}</li>
        <li><strong>Amount Paid:</strong> KSh ${price}</li>
      </ul>
    `,
  });

  // Email to bike owner (recipient hardcoded for now)
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: 'testingjim232@gmail.com',
    subject: 'Your Bike Has Been Booked & Paid',
    html: `
      <h2>Your bike has been booked!</h2>
      <ul>
        <li><strong>User Name:</strong> ${`${user.firstName || ''} ${user.lastName || ''}`.trim()}</li>
        <li><strong>User Email:</strong> ${user.email}</li>
        <li><strong>User Phone:</strong> ${user.phone || ''}</li>
        <li><strong>Booking Time:</strong> ${formattedStartTime} to ${formattedEndTime}</li>
        <li><strong>Location:</strong> ${booking.bikeLocation}</li>
        <li><strong>Amount Paid:</strong> KSh ${price}</li>
      </ul>
    `,
  });
}

// Single place that reconciles a payment with a provider result. Idempotent:
// marks the booking paid, sends emails once, and records net/tracking info.
// Used by both the webhook and the verify-on-return endpoint.
async function applyPaymentResult(payment, result) {
  payment.status = result.status;
  if (result.invoiceId) payment.invoiceId = result.invoiceId;
  if (result.netAmount != null) payment.netAmount = result.netAmount;
  if (result.trackingId) payment.trackingId = result.trackingId;

  if (result.status === 'paid') {
    if (!payment.paidAt) payment.paidAt = new Date();

    const booking = await Booking.findByIdAndUpdate(
      payment.booking,
      { paymentStatus: 'paid', status: 'active' },
      { new: true }
    );

    // Send confirmation emails exactly once.
    if (booking && !payment.notificationSent) {
      try {
        const user = await User.findById(payment.user);
        if (user) {
          await sendBookingEmails(booking, user);
          payment.notificationSent = true;
        }
      } catch (mailErr) {
        console.error('Failed to send booking emails:', mailErr);
        // Don't fail the payment confirmation just because email failed.
      }
    }
  }

  await payment.save();
  return payment;
}

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
    }
    // Bike availability is derived live from bookings (see GET /api/bikes/availability),
    // so there is no per-bike flag to reset here.
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

// ---------------------- Reviews ----------------------

// Rating summary (average + count) for every bike, keyed by bikeId.
// Used by the bikes listing page to show cumulative stars on each card.
app.get('/api/reviews/summary', async (req, res) => {
  try {
    const summary = await Review.aggregate([
      {
        $group: {
          _id: '$bikeId',
          average: { $avg: '$rating' },
          count: { $sum: 1 },
        },
      },
    ]);

    const map = {};
    summary.forEach((item) => {
      map[item._id] = {
        average: Math.round(item.average * 10) / 10,
        count: item.count,
      };
    });

    res.status(200).json({ status: 'ok', summary: map });
  } catch (err) {
    console.error('Review summary error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error.' });
  }
});

// All reviews for a single bike, plus that bike's average + count.
app.get('/api/reviews', async (req, res) => {
  const { bikeId } = req.query;
  if (!bikeId) {
    return res.status(400).json({ status: 'error', message: 'bikeId is required.' });
  }

  try {
    const reviews = await Review.find({ bikeId }).sort({ createdAt: -1 });
    const count = reviews.length;
    const average = count
      ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / count) * 10) / 10
      : 0;

    res.status(200).json({ status: 'ok', reviews, average, count });
  } catch (err) {
    console.error('Fetch reviews error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error.' });
  }
});

// Create a review. Reviewer identity is resolved from the signed-in email.
app.post('/api/reviews', async (req, res) => {
  const email = req.query.email;
  const { bikeId, rating, comment } = req.body;

  if (!bikeId || !rating) {
    return res.status(400).json({ status: 'error', message: 'bikeId and rating are required.' });
  }

  const numericRating = Number(rating);
  if (Number.isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
    return res.status(400).json({ status: 'error', message: 'Rating must be between 1 and 5.' });
  }

  try {
    let userName = 'Anonymous';
    let userEmail = email;

    if (email) {
      const user = await User.findOne({ email });
      if (user) {
        userName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username || email;
      }
    }

    const review = new Review({
      bikeId,
      userName,
      userEmail,
      rating: numericRating,
      comment,
    });

    await review.save();

    res.status(201).json({ status: 'ok', message: 'Review submitted', review });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const message = Object.values(err.errors).map((e) => e.message).join(', ');
      return res.status(400).json({ status: 'error', message });
    }
    console.error('Create review error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error.' });
  }
});

// ---------------------- Availability ----------------------

// Availability is derived live from bookings rather than a stored flag: a bike
// is "unavailable" if a booking spans the current moment. Returns a map of only
// the bikes that are booked right now, with the time each one frees up.
app.get('/api/bikes/availability', async (req, res) => {
  try {
    const now = new Date();
    const activeNow = await Booking.find({
      startTime: { $lte: now },
      endTime: { $gte: now },
    });

    const unavailable = {};
    activeNow.forEach((booking) => {
      const existing = unavailable[booking.bikeId];
      // If a bike has back-to-back bookings, report the latest free-up time.
      if (!existing || new Date(booking.endTime) > new Date(existing.until)) {
        unavailable[booking.bikeId] = { until: booking.endTime };
      }
    });

    res.status(200).json({ status: 'ok', unavailable });
  } catch (err) {
    console.error('Availability error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error.' });
  }
});

// ---------------------- Payments ----------------------

// Start a payment for a booking. Returns a hosted checkout URL the client
// redirects to (M-Pesa STK Push / card).
app.post('/api/payments/checkout', async (req, res) => {
  const email = req.query.email;
  const { bookingId } = req.body;

  if (!email || !bookingId) {
    return res.status(400).json({ status: 'error', message: 'email and bookingId are required.' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found.' });
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ status: 'error', message: 'Booking not found.' });
    }
    if (String(booking.user) !== String(user._id)) {
      return res.status(403).json({ status: 'error', message: 'This booking does not belong to you.' });
    }
    if (booking.paymentStatus === 'paid') {
      return res.status(400).json({ status: 'error', message: 'This booking is already paid.' });
    }

    // Amount always comes from the booking (server-calculated), never the client.
    const originalAmount = booking.price;

    // Testing escape hatch: set PAYMENT_TEST_AMOUNT=1 in .env to charge a flat
    // 1 KES for every booking. Remove/unset it to charge real prices again.
    const testAmount = Number(process.env.PAYMENT_TEST_AMOUNT);
    const useTestAmount = Number.isFinite(testAmount) && testAmount > 0;
    const amount = useTestAmount ? testAmount : originalAmount;

    if (useTestAmount) {
      console.warn(`[payments] TEST MODE: charging ${amount} KES instead of ${originalAmount} KES`);
    }

    // IntaSend rejects amounts under its per-method floor ("Amount provided is
    // below allowed limit for payment method"), which surfaces confusingly on
    // their hosted page. Fail here instead, with a message that says why.
    const MIN_CHARGE_KES = 10;
    if (amount < MIN_CHARGE_KES) {
      return res.status(400).json({
        status: 'error',
        message: `Amount (${amount} KES) is below the payment provider's minimum of ${MIN_CHARGE_KES} KES.`,
      });
    }

    const apiRef = `BIKEY-${booking._id}-${Date.now()}`;

    const payment = new Payment({
      booking: booking._id,
      user: user._id,
      userEmail: user.email,
      bikeId: booking.bikeId,
      bikeOwner: booking.bikeOwner,
      amount,
      originalAmount,
      providerRef: apiRef,
      provider: payments.name,
      status: 'pending',
    });

    const checkout = await payments.createCheckout({
      amount,
      email: user.email,
      firstName: user.firstName || user.username || 'Bikey',
      lastName: user.lastName || 'User',
      apiRef,
      host: process.env.FRONTEND_URL,
      redirectUrl: `${process.env.FRONTEND_URL}/payment/callback?ref=${encodeURIComponent(apiRef)}`,
    });

    payment.checkoutId = checkout.checkoutId;
    payment.signature = checkout.signature;
    payment.checkoutUrl = checkout.checkoutUrl;
    payment.invoiceId = checkout.invoiceId;
    await payment.save();

    res.status(201).json({
      status: 'ok',
      checkoutUrl: checkout.checkoutUrl,
      ref: apiRef,
      amount,
      originalAmount,
      testMode: useTestAmount,
    });
  } catch (err) {
    console.error('Create checkout error:', err);
    res.status(500).json({ status: 'error', message: 'Could not start payment. Please try again.' });
  }
});

// Read the current confirmation status of a payment. The callback page polls
// this after the user returns from checkout.
//
// Note: IntaSend's status API requires the invoice_id, which only exists once
// payment completes and is delivered via webhook — it is NOT in the redirect
// URL. So this endpoint re-checks with the provider only if we already have an
// invoice_id (from the webhook); otherwise it reports the stored status, which
// the webhook keeps up to date.
app.get('/api/payments/verify', async (req, res) => {
  const { ref } = req.query;
  if (!ref) {
    return res.status(400).json({ status: 'error', message: 'ref is required.' });
  }

  try {
    const payment = await Payment.findOne({ providerRef: ref });
    if (!payment) {
      return res.status(404).json({ status: 'error', message: 'Payment not found.' });
    }

    // Re-confirm with the provider when we can (invoice_id known and not yet paid).
    if (payment.status !== 'paid' && payment.invoiceId) {
      try {
        const result = await payments.verifyPayment({ invoiceId: payment.invoiceId });
        await applyPaymentResult(payment, result);
      } catch (verifyErr) {
        console.error('Provider verify failed, falling back to stored status:', verifyErr);
      }
    }

    res.status(200).json({
      status: 'ok',
      paymentStatus: payment.status,
      amount: payment.amount,
      netAmount: payment.netAmount,
    });
  } catch (err) {
    console.error('Verify payment error:', err);
    res.status(500).json({ status: 'error', message: 'Could not verify payment.' });
  }
});

// Authoritative confirmation path. IntaSend POSTs here when a payment settles,
// including the invoice_id, api_ref and state. Requires a public URL (works in
// production on Vercel). We re-verify with the provider rather than trusting
// the payload outright.
app.post('/api/payments/webhook', async (req, res) => {
  try {
    // Optional shared-secret check. Configure the same value as your IntaSend
    // webhook "challenge" to reject spoofed calls.
    const expectedChallenge = process.env.INTASEND_WEBHOOK_CHALLENGE;
    if (expectedChallenge && req.body.challenge !== expectedChallenge) {
      return res.status(401).json({ status: 'error', message: 'Invalid challenge.' });
    }

    const apiRef = req.body.api_ref;
    const invoiceId = req.body.invoice_id;
    if (!apiRef && !invoiceId) {
      return res.status(400).json({ status: 'error', message: 'api_ref or invoice_id required.' });
    }

    const payment = apiRef
      ? await Payment.findOne({ providerRef: apiRef })
      : await Payment.findOne({ invoiceId });

    if (!payment) {
      // Acknowledge so IntaSend doesn't keep retrying an unknown ref.
      return res.status(200).json({ status: 'ok', message: 'No matching payment.' });
    }

    if (payment.status !== 'paid') {
      if (invoiceId && !payment.invoiceId) payment.invoiceId = invoiceId;

      // Re-verify with the provider using the now-known invoice_id.
      const result = await payments.verifyPayment({ invoiceId: payment.invoiceId });
      await applyPaymentResult(payment, result);
    }

    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('Payment webhook error:', err);
    res.status(500).json({ status: 'error', message: 'Webhook handling failed.' });
  }
});

// Earnings time-series for the owner / admin dashboards.
//   ?owner=<bikeOwner>  restricts to one owner (omit for platform-wide/admin)
//   ?groupBy=day|month  bucket size (default: day)
app.get('/api/payments/earnings', async (req, res) => {
  const { owner, groupBy } = req.query;
  const format = groupBy === 'month' ? '%Y-%m' : '%Y-%m-%d';

  try {
    const match = { status: 'paid' };
    if (owner) match.bikeOwner = owner;

    const series = await Payment.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format, date: '$paidAt' } },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: '$_id', total: 1, count: 1 } },
    ]);

    const totalEarnings = series.reduce((sum, point) => sum + point.total, 0);
    const totalPayments = series.reduce((sum, point) => sum + point.count, 0);

    res.status(200).json({ status: 'ok', series, totalEarnings, totalPayments });
  } catch (err) {
    console.error('Earnings error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error.' });
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

    if (end < new Date()) {
      return res.status(400).json({ status: 'error', message: 'Cannot book a time in the past.' });
    }

    // Fetch authoritative price from Sanity — never trust client-submitted price
    const bike = await sanityClient.fetch(
      `*[_type == "bike" && _id == $bikeId][0]{ price }`,
      { bikeId }
    );
    if (!bike || bike.price == null) {
      return res.status(404).json({ status: 'error', message: 'Bike not found or has no price set.' });
    }

    // Billed in 15-minute increments rounded down, with a 1-hour minimum.
    // e.g. 1h10m -> 1h00m, 1h15m -> 1h15m. The epsilon guards against a clean
    // boundary (e.g. exactly 90 min reading as 89.9999) flooring incorrectly.
    const totalMinutes = (end - start) / 1000 / 60;
    const blocks = Math.floor(totalMinutes / 15 + 1e-9);
    const billableMinutes = Math.max(60, blocks * 15);
    const calculatedPrice = Math.round((billableMinutes / 60) * bike.price);

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found. Please sign up first.' });
    }

    // Conflicts include a 10-minute buffer before each existing booking's start,
    // so a new booking must end at least 10 minutes before the next one begins.
    const BUFFER_MS = 10 * 60 * 1000;
    const overlappingBooking = await Booking.findOne({
      bikeId,
      startTime: { $lt: new Date(end.getTime() + BUFFER_MS) },
      endTime: { $gt: start },
    });

    if (overlappingBooking) {
      return res.status(400).json({
        status: 'error',
        message: 'Bike is unavailable for the selected time. Bookings need a 10-minute gap before the next one starts.',
      });
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

    // Confirmation emails are sent after payment is received (see
    // applyPaymentResult), not here.
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