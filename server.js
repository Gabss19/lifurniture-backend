const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected!'))
  .catch(err => console.log('DB Error:', err));

// Appointment Schema
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
  createdAt: { type: Date, default: Date.now }
});

const Appointment = mongoose.model('Appointment', appointmentSchema);

// POST - Verify admin password securely on the server
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    res.json({ success: true, message: 'Authenticated' });
  } else {
    res.status(401).json({ success: false, message: 'Invalid password' });
  }
});

// POST - Save appointment (With Spam Filter & Missing Field Validation)
app.post('/api/appointments', async (req, res) => {
  try {
    // 1. Honeypot check: If this hidden field has data, reject it immediately
    if (req.body.honeyField && req.body.honeyField.trim() !== '') {
      console.log('🤖 Bot submission blocked!');
      return res.status(400).json({ success: false, message: 'Spam validation failed.' });
    }

    // 2. Destructure inputs to validate them
    const { firstName, lastName, phone, email, address, service, prefDate, prefTime } = req.body;

    // 3. Strict Server-Side Validation: Ensure no required fields are blank
    if (!firstName || !lastName || !phone || !email || !address || !service || !prefDate || !prefTime) {
      return res.status(400).json({ success: false, message: 'Missing required information. All fields except budget and notes are mandatory.' });
    }

    // 4. Basic Email Format Validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    // 5. Save to MongoDB Atlas if everything is valid
    const appointment = new Appointment(req.body);
    await appointment.save();
    res.json({ success: true, message: 'Appointment saved!' });
    
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// GET - Get all appointments (for admin)
app.get('/api/appointments', async (req, res) => {
  try {
    const appointments = await Appointment.find().sort({ createdAt: -1 });
    res.json(appointments);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// NEW: DELETE - Delete a single appointment from MongoDB Atlas by ID
app.delete('/api/appointments/:id', async (req, res) => {
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
