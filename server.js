const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Middleware to protect admin-only API routes
function requireAdminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token === process.env.ADMIN_PASSWORD) {
    next();
  } else {
    res.status(401).json({ success: false, message: 'Unauthorized' });
  }
}

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected!'))
  .catch(err => console.log('DB Error:', err));

// Appointment Schema (Updated to include status tracking)
const appointmentSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  phone: String,
  email: String,
  address: String,
  service: String,
  budget: String,
  prefDate: String,
  prefTime: String,
  notes: String,
  status: { type: String, default: 'Pending' },
  createdAt: { type: Date, default: Date.now }
});

const Appointment = mongoose.model('Appointment', appointmentSchema);

// Helper function to create the email engine cleanly
function createEmailTransporter() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, 
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
}



// POST - Verify admin password securely on the server
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    res.json({ success: true, message: 'Authenticated' });
  } else {
    res.status(401).json({ success: false, message: 'Invalid password' });
  }
});

// POST - Save appointment (With Spam Filters, Day Lock, & Automated Email Notification)
app.post('/api/appointments', async (req, res) => {
  try {
    // 1. Honeypot check
    if (req.body.honeyField && req.body.honeyField.trim() !== '') {
      console.log('🤖 Bot submission blocked!');
      return res.status(400).json({ success: false, message: 'Spam validation failed.' });
    }

    // 2. Destructure inputs
    const { firstName, lastName, phone, email, address, service, prefDate, prefTime } = req.body;

    // 3. Strict Server-Side Validation
    if (!firstName || !lastName || !phone || !email || !address || !service || !prefDate || !prefTime) {
      return res.status(400).json({ success: false, message: 'Missing required information.' });
    }

    // 4. Basic Email Format Validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    // 5. Lock down the ENTIRE DAY regardless of morning or afternoon selection
    const dayIsOccupied = await Appointment.findOne({ prefDate: prefDate });
    if (dayIsOccupied) {
      return res.status(400).json({ 
        success: false, 
        message: 'This date is already fully booked for a site visit. Please select a different day.' 
      });
    }

    // 6. Check if the exact same customer just submitted an identical form
    const duplicateCustomer = await Appointment.findOne({
      firstName: firstName,
      lastName: lastName,
      prefDate: prefDate
    });
    if (duplicateCustomer) {
      return res.status(400).json({ 
        success: false, 
        message: 'You have already requested a site visit for this day!' 
      });
    }

    // 7. Save to MongoDB Atlas if the day is completely free
    const appointment = new Appointment(req.body);
    await appointment.save();

    // 8. Trigger Automated Confirmation Email Engine in the background
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      const transporter = createEmailTransporter();
      const mailOptions = {
        from: `"LiFurniture Notifications" <${process.env.EMAIL_USER}>`,
        to: [email, process.env.EMAIL_USER], // Notifies both client and your store
        subject: `LiFurniture Site Visit Request Received - ${firstName} ${lastName}`,
        html: `
          <h3>Hello ${firstName},</h3>
          <p>Thank you for reaching out to LiFurniture! We have successfully received your request for a free site visit.</p>
          <hr>
          <h4>Appointment Details:</h4>
          <ul>
            <li><strong>Project Type:</strong> ${service}</li>
            <li><strong>Preferred Date:</strong> ${prefDate}</li>
            <li><strong>Preferred Time:</strong> ${prefTime}</li>
            <li><strong>Address:</strong> ${address}</li>
          </ul>
          <hr>
          <p>Our admin team is currently reviewing your schedule. We will update your appointment status and confirm with you shortly.</p>
          <br>
          <p>Best regards,<br><strong>LiFurniture Team</strong></p>
        `
      };

      transporter.sendMail(mailOptions, (error) => {
        if (error) console.error('Email delivery error:', error);
        else console.log('Confirmation emails delivered successfully!');
      });
    }

    res.json({ success: true, message: 'Appointment saved!' });
    
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET - Get all appointments (for admin)
app.get('/api/appointments', requireAdminAuth, async (req, res) => {
  try {
    const appointments = await Appointment.find().sort({ createdAt: -1 });
    res.json({ appointments, total: appointments.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET - Single appointment lookup (for customer status tracking)
app.get('/api/appointments/lookup', async (req, res) => {
  try {
    const { email, date } = req.query;
    if (!email || !date) {
      return res.status(400).json({ success: false, message: 'Email and date are required.' });
    }
    const appt = await Appointment.findOne(
      { email: email, prefDate: date },
      'firstName lastName service prefDate prefTime status createdAt'
    );
    if (!appt) {
      return res.status(404).json({ success: false, message: 'No appointment found for that email and date.' });
    }
    res.json({ success: true, appointment: appt });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET - Fetch just a list of booked dates to disable them on the calendar
app.get('/api/appointments/booked-dates', async (req, res) => {
  try {
    const appointments = await Appointment.find({}, 'prefDate');
    const bookedDates = appointments.map(appt => appt.prefDate).filter(Boolean);
    res.json(bookedDates); 
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT - Update appointment status from admin dashboard + send notification
app.put('/api/appointments/:id/status', requireAdminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const updatedAppt = await Appointment.findByIdAndUpdate(req.params.id, { status }, { new: true });

    if (!updatedAppt) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }

    // Automatically send an update alert to the customer if status shifts to Confirmed
    if (status === 'Confirmed' && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      const transporter = createEmailTransporter();
      const updateMail = {
        from: `"LiFurniture Notifications" <${process.env.EMAIL_USER}>`,
        to: updatedAppt.email,
        subject: `Appointment Confirmed! - LiFurniture`,
        html: `
          <h3>Hi ${updatedAppt.firstName},</h3>
          <p>Good news! Your physical site inspection appointment scheduled for <strong>${updatedAppt.prefDate}</strong> has been officially <strong>CONFIRMED</strong> by the LiFurniture team.</p>
          <p>Our craftsmen will arrive during your preferred time window. If you need to rearrange your details, please reach out to us directly via our contact number.</p>
          <br>
          <p>See you soon,<br><strong>LiFurniture Team</strong></p>
        `
      };
      transporter.sendMail(updateMail);
    }

    res.json({ success: true, message: 'Status updated!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE - Delete a single appointment from MongoDB Atlas by ID
app.delete('/api/appointments/:id', requireAdminAuth, async (req, res) => {
  try {
    const deletedAppt = await Appointment.findByIdAndDelete(req.params.id);
    if (!deletedAppt) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }
    res.json({ success: true, message: 'Appointment deleted successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
