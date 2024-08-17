require("dotenv").config();
const express = require("express");
const app = express();
const nodemailer = require("nodemailer");
const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const transporter = nodemailer.createTransport({
  service: process.env.service,
  auth: {
    user: process.env.EMAIL, // replace with your Gmail email address
    pass: process.env.APP_PASSWORD, // replace with your Gmail password or app password
  },
});

const userSchema = mongoose.Schema({
  firstName: String,
  lastName: String,
  email: String,
  password: String,
});

const Temp = mongoose.model(
  "tempDetails",
  mongoose.Schema({
    firstName: String,
    lastName: String,
    email: String,
    password: String,
    uid: String,
    sid: String,
    createdAt: { type: Date, expires: "2m", default: Date.now },
  })
);

mongoose.connect(process.env.DB_CONNECTOR);
const User = mongoose.model("user", userSchema);

const socket = require("socket.io");
const http = require("http");
const { resolve } = require("path");
const { rejects } = require("assert");
const server = http.createServer(app);
const io = socket(server);
io.on("connection", (socket) => {
  console.log("a user connected", socket.id);
});

const sendToMail = (to, id) =>
  new Promise((resolve, rejects) => {
    const mailOptions = {
      from: process.env.EMAIL, // replace with your Gmail email address
      to: to, // replace with the recipient's email address
      subject: "Email Verification",
      html: `
        <div style="width: 100%; text-align: center;">
          <h4>
            To complete your registration, verify your email by clicking the button below.
          </h4>
          <a
            href="http://localhost:3000/registration/validate/${id}"
            style="
              display: inline-block;
              padding: 10px 20px;
              font-size: 16px;
              color: white;
              background-color: #350ab9;
              text-decoration: none;
              border-radius: 5px;
              margin-top: 20px;
            ">
            Verify your email
          </a>
        </div>
      `,
    };

    transporter
      .sendMail(mailOptions)
      .then(() => {
        console.log("mail sent");
        resolve();
      })
      .catch((err) => {
        reject();
        console.error(err);
      });
  });

const checkEmail = (email) =>
  new Promise(async (resolve, rejects) => {
    try {
      const user = await User.findOne({ email });
      if (user) rejects({ message: "Email already taken", status: 409 });
      const temp = await Temp.findOne({ email });
      if (temp) rejects({ message: "Email already taken", status: 409 });
      resolve({ message: "Email Available", status: 200 });
    } catch (err) {
      console.error(err);
      rejects({ message: "Database Error", status: 500 });
    }
  });

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

app.get("/login", (req, res) => {
  res.sendFile(__dirname + "/login.html");
});

app.get("/verified", (req, res) => {
  res.sendFile(__dirname + "/verified.html");
});

app.get("/registration", (req, res) => {
  res.sendFile(__dirname + "/registration.html");
});

app.post("/registration", (req, res) => {
  function validateRegistrationFields(
    firstName,
    lastName,
    email,
    password,
    confirmPassword,
    sid
  ) {
    const fields = {
      firstName,
      lastName,
      email,
      password,
      confirmPassword,
      sid,
    };

    for (const key in fields) {
      if (!fields[key] || fields[key].trim() === "") {
        return false; // Return false if any field is empty, null, or undefined
      }
    }

    return true; // All fields are valid
  }

  const { firstName, lastName, email, password, confirmPassword, sid } =
    req.body;

  if (
    !validateRegistrationFields(
      firstName,
      lastName,
      email,
      password,
      confirmPassword,
      sid
    )
  ) {
    res.status(400).json({ message: "Empty fields found" });
    return;
  }

  if (password !== confirmPassword) {
    res.status(400).send("Password and Confirm Password do not match");
    return;
  }

  checkEmail(email)
    .then((msg) => {
      const uid = uuidv4();
      const temp = new Temp({ firstName, lastName, email, password, uid, sid });
      temp
        .save()
        .then((_) => {
          sendToMail(email, uid)
            .then(() => {
              res.status(200).json({ message: msg.message });
            })
            .catch((err) => {
              console.error(err);
              Temp.findOneAndDelete({ email });
              res.status(500).json({ message: "unable to send email" });
            });
        })
        .catch((err) => {
          console.log(err);
          res.status(500).json({ message: "Internal server error" });
        });
    })
    .catch((err) => {
      res.status(err.status).json({ message: err.message });
    });
});

app.get("/registration/validate/:id", (req, res) => {
  const { id } = req.params;
  Temp.findOne({ uid: id }).then(async (temp) => {
    if (!temp) {
      res.send("Session time out");
    } else {
      const email = temp.email;
      const usr = await User.findOne({ email });
      if (usr) {
        res.sendFile(__dirname + "/verified.html");
        return;
      }
      const user = new User({
        firstName: temp.firstName,
        lastName: temp.lastName,
        email: temp.email,
        password: temp.password,
      });
      user
        .save()
        .then((_) => {
          io.to(temp.sid).emit("redirect");
          res.sendFile(__dirname + "/verified.html");
        })
        .catch((err) => {
          console.error(err);
          res.send("Internal server error try again");
        });
    }
  });
});

app.get("/timeout", (req, res) => {
  res.sendFile(__dirname + "/timeout.html");
});

server.listen(3000, () => {
  console.log("server listning in port 3000");
});
