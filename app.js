const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = 3000;
const SECRET_KEY = 'your_secret_key';
const ADMIN_CREDENTIALS = { username: 'Admin', password: 'Password' };

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'));
app.set('view engine', 'ejs');

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/', { useNewUrlParser: true, useUnifiedTopology: true });

// User Schema
const userSchema = new mongoose.Schema({
  username: String,
  password: String,
});

const User = mongoose.model('User', userSchema);

// Note Schema
const noteSchema = new mongoose.Schema({
  title: String,
  description: String,
  tag: String,
  userId: mongoose.Schema.Types.ObjectId,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date }
});

const Note = mongoose.model('Note', noteSchema);

// Activity Schema
const activitySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.Mixed, required: true },
  activity: String,
  timestamp: { type: Date, default: Date.now }
});

const Activity = mongoose.model('Activity', activitySchema);

// Notification Schema
const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const Notification = mongoose.model('Notification', notificationSchema);

// Authentication Middleware
const authMiddleware = (req, res, next) => {
  const token = req.cookies.token;
  if (token) {
    jwt.verify(token, SECRET_KEY, (err, decoded) => {
      if (err) {
        return res.redirect('/login');
      } else {
        req.userId = decoded.id;
        next();
      }
    });
  } else {
    res.redirect('/login');
  }
};

// Admin Middleware
const adminMiddleware = (req, res, next) => {
  const token = req.cookies.token;
  if (token) {
    jwt.verify(token, SECRET_KEY, (err, decoded) => {
      if (err || decoded.username !== ADMIN_CREDENTIALS.username) {
        return res.redirect('/login');
      } else {
        next();
      }
    });
  } else {
    res.redirect('/login');
  }
};

// Routes
app.get('/', (req, res) => {
  res.render('index');
});

app.get('/signup', (req, res) => {
  res.render('signup');
});

app.post('/signup', async (req, res) => {
  const { username, password } = req.body;
  
  // Check if username already exists
  const existingUser = await User.findOne({ username });
  if (existingUser) {
    return res.redirect('/signup?error=Username%20already%20exists.%20Please%20try%20another%20username');
  }

  // Enforce username length
  if (username.length < 5 || username.length > 20) {
    return res.redirect('/signup?error=Username%20should%20be%20between%205%20and%2020%20characters%20long');
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = new User({ username, password: hashedPassword });
  await newUser.save();
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
    // Admin login
    const token = jwt.sign({ id: 'admin', username }, SECRET_KEY);
    res.cookie('token', token, { httpOnly: true });
    return res.redirect('/admin-dashboard');
  }

  const user = await User.findOne({ username });

  if (!user) {
    // User does not exist
    return res.redirect('/login?error=User%20does%20not%20exist');
  }

  if (await bcrypt.compare(password, user.password)) {
    // Valid user
    const token = jwt.sign({ id: user._id, username: user.username }, SECRET_KEY);
    res.cookie('token', token, { httpOnly: true });
    return res.redirect('/dashboard');
  } else {
    // Invalid password
    return res.redirect('/login?error=Invalid%20username%20or%20password');
  }
});

app.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/login');
});

// Route for rendering dashboard with username and notes
// Render dashboard with notifications
app.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const notes = await Note.find({ userId: req.userId });
    const hasNewNotifications = await checkForNewNotifications(req.userId); // Check if there are new notifications
    res.render('dashboard', { username: user.username, notes, hasNewNotifications });
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).send('An error occurred');
  }
});

// Function to check for new notifications
const checkForNewNotifications = async (userId) => {
  try {
    const notifications = await Notification.find({ userId });
    return notifications.length > 0;
  } catch (error) {
    console.error('Error checking for new notifications:', error);
    return false;
  }
};


// logActivity function
const logActivity = async (userId, activity) => {
  const newActivity = new Activity({ activity, userId });
  await newActivity.save();
};

app.post('/create-note', authMiddleware, async (req, res) => {
  const { title, description, tag } = req.body;
  const newNote = new Note({
    title,
    description,
    tag,
    userId: req.userId,
    createdAt: new Date()
  });
  await newNote.save();
  await logActivity(req.userId, 'Created a note');
  res.redirect('/dashboard?created=true');
});

app.post('/update-note', authMiddleware, async (req, res) => {
  const { id, title, description } = req.body;
  await Note.findByIdAndUpdate(id, {
    title,
    description,
    updatedAt: new Date()
  });
  await logActivity(req.userId, 'Updated a note');
  res.redirect('/dashboard?updated=true');
});

app.post('/delete-note', authMiddleware, async (req, res) => {
  const { id } = req.body;
  console.log('Deleting note with ID:', id);
  try {
    await Note.findByIdAndDelete(id);
    console.log('Note deleted successfully');
    await logActivity(req.userId, 'Deleted a note');
    res.json({ message: 'Note deleted successfully' });
  } catch (error) {
    console.error('Error deleting note:', error);
    res.status(500).json({ message: 'An error occurred while deleting the note.' });
  }
});

// Admin Dashboard Route
app.get('/admin-dashboard', adminMiddleware, async (req, res) => {
  try {
    const users = await User.find({});
    const notes = await Note.find({});
    const activities = await Activity.find({}).populate('userId'); // Populate userId field
    res.render('admin-dashboard', { users, notes, activities });
  } catch (error) {
    console.error('Error fetching admin data:', error);
    res.status(500).send('An error occurred');
  }
});

// Route for deleting a note from admin dashboard
app.post('/delete-note-admin', adminMiddleware, async (req, res) => {
  const { id } = req.body;
  console.log('Admin is deleting note with ID:', id);
  try {
    // Delete the note
    await Note.findByIdAndDelete(id);
    console.log('Note deleted successfully');

    // Log the activity with admin identifier
    await logActivity('admin', 'Deleted a note');

    // Redirect the user to the admin dashboard
    res.redirect('/admin-dashboard');
  } catch (error) {
    console.error('Error deleting note:', error);
    res.status(500).json({ message: 'An error occurred while deleting the note.' });
  }
});

// Route for sending notification
app.post('/send-notification', adminMiddleware, async (req, res) => {
  const { userId, title, message } = req.body;
  try {
    const notification = new Notification({ userId, title, message });
    await notification.save();
    res.redirect('/admin-dashboard');
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).send('An error occurred');
  }
});

// Route for viewing notifications
app.get('/notifications', authMiddleware, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.render('notifications', { notifications });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).send('An error occurred');
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
