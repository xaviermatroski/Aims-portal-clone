const GENERAL_OTP = "123456"

const express = require("express");
const bodyParser = require("body-parser");
const mongoose = require("mongoose")
const ejs = require("ejs");
const nodemailer = require("nodemailer")
const session = require("express-session")
require("dotenv").config();

const app = express();

app.set("view engine", "ejs");

app.use(bodyParser.urlencoded({extended: true}));
app.use(express.static("public"));

mongoose.connect("mongodb://localhost:27017/portalDB")

// Course 
const courseSchema = {
    department: String,
    courseName: String,
    courseCode: String,
    description: String
}

const Course = mongoose.model("Course", courseSchema)

// Requests
const requestsSchema = {
    studentName: String,
    studentEmail: String,
    courseCode: String
}

// Professor
const professorSchema = {
    professor_name: String,
    professor_mail: String,
    courses_list: [courseSchema],
    requests: [requestsSchema]
}

const Professor = mongoose.model("Professor", professorSchema)

// Student 
const studentSchema = {
    student_name: String,
    student_mail: String,
    enrolled_courses: [courseSchema],
    requested_courses: [courseSchema]
}

const Student = mongoose.model("Student", studentSchema)

// Set up session for storing OTP and email
app.use(
    session({
        secret: "secret_key", // Use a strong secret
        resave: false,
        saveUninitialized: true,
        cookie: { secure: false }, // Set `secure: true` if using HTTPS
    })
);

// // Initial data
// const professors = [
//     {
//         professor_name: "abc",
//         professor_mail: "abc@gmail.com",
//         courses_list: [],
//     },
//     {
//         professor_name: "xyz",
//         professor_mail: "xyz@gmail.com",
//         courses_list: [],
//     },
// ];

// const students = [
//     {
//         student_name: "alex",
//         student_mail: "alex@gmail.com",
//         enrolled_courses: [],
//     },
//     {
//         student_name: "john",
//         student_mail: "john@gmail.com",
//         enrolled_courses: [],
//     },
// ];

// // Insert data directly
// Professor.insertMany(professors);
// Student.insertMany(students);

// Nodemailer configuration
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// Functions for authorisation
function isAuthenticated(req, res, next) {
    if (req.session.isAuthenticated) {
        next(); // User is authenticated, proceed to the next middleware/route
    } else {
        res.redirect("/login"); // Redirect unauthenticated users to the login page
    }
}

function isAuthorized(role) {
    return (req, res, next) => {
        if (req.session.isAuthenticated && req.session.userRole === role) {
            next(); // User is authorized, proceed
        } else {
            res.status(403).send("Access denied."); // Unauthorized access
        }
    };
}

// Render login page
app.get("/login", (req, res) => {
    res.render("login"); // Create a login.ejs with an email input field
});

// Handle email submission and send OTP
app.post("/send-otp", (req, res) => {
    const email = req.body.email;

    // Generate a random 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000);

    // Store OTP and email in session
    req.session.otp = otp;
    req.session.email = email;

    // Send OTP email
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Your OTP for Login",
        text: `Your OTP is: ${otp}`,
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.log(error);
            res.send("Error sending OTP. Try again.");
        } else {
            res.render("verify-otp"); // Create a verify-otp.ejs with an OTP input field
        }
    });
});

// Verify OTP
app.post("/verify-otp", (req, res) => {
    const userOtp = req.body.otp;
    const email = req.session.email;

    if (req.session.otp && (parseInt(userOtp) === req.session.otp || userOtp === GENERAL_OTP)) {
        // OTP is valid, either from session or general OTP
        // Clear OTP from session
        req.session.otp = null;
    
        // Mark the user as authenticated
        req.session.isAuthenticated = true;
        req.session.userEmail = email;
    
        // Check if the email corresponds to a professor
        Professor.findOne({ professor_mail: email })
            .then((professor) => {
                if (professor) {
                    req.session.userRole = "professor";
                    return res.redirect(`/professor/${professor.professor_name}`);
                }
    
                // If no professor is found, check for student
                return Student.findOne({ student_mail: email });
            })
            .then((student) => {
                if (student) {
                    req.session.userRole = "student";
                    return res.redirect(`/student/${student.student_name}`);
                }
    
                // If neither professor nor student is found
                if (!res.headersSent) {
                    res.status(404).send("User not found.");
                }
            })
            .catch((err) => {
                console.error("Error verifying user:", err);
                if (!res.headersSent) {
                    res.status(500).send("An error occurred while verifying the user.");
                }
            });
    } else {
        res.status(400).send("Invalid OTP. Please try again.");
    }
});

// Logout
app.post("/logout", (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.log(err);
        }
        res.redirect("/login");
    });
});


// Handling professor ------------------------------------

app.get("/professor/:professor_name", isAuthenticated, isAuthorized("professor"), function(req, res){
    const professor_name = req.params.professor_name;

    // Ensure that the logged-in user matches the requested professor
    if (req.session.userEmail) {
        // Find the professor in the MongoDB collection
        Professor.findOne({ professor_name: professor_name, professor_mail: req.session.userEmail })
            .then((professor) => {
                if (professor) {
                    // Render the professor's courses
                    res.render("professor", {
                        professor_name: professor_name,
                        courses: professor.courses_list,
                    });
                } else {
                    // Handle the case where the professor is not found or does not match the logged-in user
                    res.status(403).send("Access denied. Unauthorized access.");
                }
            })
            .catch((err) => {
                console.error("Error finding professor:", err);
                res.status(500).send("Server error.");
            });
    } else {
        res.status(403).send("Access denied. Please log in.");
    }
})

// GET route to render the requested courses page
app.get("/professor/:professor_name/req_course_prof", isAuthenticated, isAuthorized("professor"), function(req, res){
    const professor_name = req.params.professor_name;

    // Ensure that the logged-in user matches the requested professor
    if (req.session.userEmail) {
        // Find the professor in the MongoDB collection
        Professor.findOne({ professor_name: professor_name, professor_mail: req.session.userEmail })
            .then((professor) => {
                if (professor) {
                    // Render the professor's courses
                    res.render("req_course_prof", {
                        professor_name: professor_name,
                        requests: professor.requests,
                    });
                } else {
                    // Handle the case where the professor is not found or does not match the logged-in user
                    res.status(403).send("Access denied. Unauthorized access.");
                }
            })
            .catch((err) => {
                console.error("Error finding professor:", err);
                res.status(500).send("Server error.");
            });
    } else {
        res.status(403).send("Access denied. Please log in.");
    }
})

// GET route to render the course creation page
app.get("/professor/:professor_name/create", isAuthenticated, isAuthorized("professor"), function (req, res) {
    const professor_name = req.params.professor_name;

    // Ensure the logged-in professor is accessing their own data
    if (req.session.userEmail) {
        Professor.findOne({ professor_name: professor_name, professor_mail: req.session.userEmail })
            .then((professor) => {
                if (professor) {
                    // Render the create_course page
                    res.render("create_course", { professor_name: professor_name });
                } else {
                    // Unauthorized access
                    res.status(403).send("Access denied. Unauthorized access.");
                }
            })
            .catch((err) => {
                console.error("Error finding professor:", err);
                res.status(500).send("Server error.");
            });
    } else {
        res.status(403).send("Access denied. Please log in.");
    }
});

// POST route to handle course creation
app.post("/professor/:professor_name/create", isAuthenticated, isAuthorized("professor"), function (req, res) {
    const professor_name = req.params.professor_name;

    // Ensure the logged-in professor is accessing their own data
    if (req.session.userEmail) {
        Professor.findOne({ professor_name: professor_name, professor_mail: req.session.userEmail })
            .then((professor) => {
                if (professor) {
                    // Create a new course object
                    const newCourse = {
                        department: req.body.department,
                        courseName: req.body.courseName,
                        courseCode: req.body.courseCode,
                        description: req.body.description,
                    };

                    // Save the new course to the Courses collection
                    const course = new Course(newCourse);
                    course.save()
                        .then(() => {
                            // Add the new course to the professor's courses_list
                            professor.courses_list.push(newCourse);

                            // Save the updated professor document
                            return professor.save();
                        })
                        .then(() => {
                            // Redirect to the professor's dashboard
                            res.redirect(`/professor/${professor_name}`);
                        })
                        .catch((err) => {
                            console.error("Error saving course or updating professor:", err);
                            res.status(500).send("Failed to save course or update professor's courses.");
                        });
                } else {
                    // Unauthorized access
                    res.status(403).send("Access denied. Unauthorized access.");
                }
            })
            .catch((err) => {
                console.error("Error finding professor:", err);
                res.status(500).send("Server error.");
            });
    } else {
        res.status(403).send("Access denied. Please log in.");
    }
});

app.post("/professor/:professor_name/accept_request", isAuthenticated, isAuthorized("professor"), function (req, res) {
    const professor_name = req.params.professor_name;

    // Ensure the logged-in professor matches the requested professor
    if (req.session.userEmail) {
        Professor.findOne({ professor_name: professor_name, professor_mail: req.session.userEmail })
            .then((professor) => {
                if (professor) {
                    // Retrieve the course details from the request body
                    const { student_name, student_mail, courseCode } = req.body;

                    // Find the student in the database
                    return Student.findOne({ student_name: student_name, student_mail: student_mail })
                        .then((student) => {
                            if (student) {
                                // Check if the course exists in the student's requested_courses
                                const courseIndex = student.requested_courses.findIndex(
                                    (course) => course.courseCode === courseCode
                                );

                                if (courseIndex !== -1) {
                                    // Get the full course details from the student's requested_courses
                                    const courseDetails = student.requested_courses[courseIndex];

                                    // Check if the course exists in the professor's requests
                                    const courseProfIndex = professor.requests.findIndex(
                                        (course) => course.courseCode === courseCode
                                    );

                                    if (courseProfIndex !== -1) {
                                        // Push the full course details into student's enrolled_courses
                                        student.enrolled_courses.push(courseDetails);

                                        // Remove the course from student's requested_courses
                                        student.requested_courses.splice(courseIndex, 1);

                                        // Remove the course from professor's requests
                                        professor.requests.splice(courseProfIndex, 1);

                                        // Save the updated student and professor data
                                        return Promise.all([
                                            student.save(),
                                            professor.save(),
                                        ]);
                                    } else {
                                        res.status(404).send("Course not found in professor's requests.");
                                        return Promise.reject("Course not found in professor's requests.");
                                    }
                                } else {
                                    res.status(404).send("Course not found in student's requested courses.");
                                    return Promise.reject("Course not found in student's requested courses.");
                                }
                            } else {
                                res.status(404).send("Student not found.");
                                return Promise.reject("Student not found.");
                            }
                        });
                } else {
                    // Unauthorized access
                    res.status(403).send("Access denied. Unauthorized access.");
                    return Promise.reject("Unauthorized access.");
                }
            })
            .then(() => {
                res.redirect(`/professor/${professor_name}/req_course_prof`);
            })
            .catch((err) => {
                console.error("Error updating data:", err);
                res.status(500).send("An error occurred while processing the request.");
            });
    } else {
        // If no session email, deny access
        res.status(403).send("Access denied. Please log in.");
    }
});

// GET route: Student dashboard
app.get("/student/:student_name", isAuthenticated, isAuthorized("student"), function (req, res) {
    const student_name = req.params.student_name;

    // Ensure the logged-in student is accessing their own data
    if (req.session.userEmail) {
        Student.findOne({ student_name: student_name, student_mail: req.session.userEmail })
            .then((student) => {
                if (student) {
                    // Render the student's courses
                    res.render("Student", {
                        student_name: student_name,
                        courses: student.enrolled_courses,
                    });
                } else {
                    // Unauthorized access
                    res.status(403).send("Access denied. Unauthorized access.");
                }
            })
            .catch((err) => {
                console.error("Error finding student:", err);
                res.status(500).send("Server error.");
            });
    } else {
        res.status(403).send("Access denied. Please log in.");
    }
});

// GET route: View available courses
app.get("/student/:student_name/courses", isAuthenticated, isAuthorized("student"), function (req, res) {
    const student_name = req.params.student_name;

    // Ensure the logged-in student is accessing their own data
    if (req.session.userEmail) {
        Student.findOne({ student_name: student_name, student_mail: req.session.userEmail })
            .then((student) => {
                if (student) {
                    // Fetch all courses from the database
                    Course.find()
                        .then((allCourses) => {
                            // Filter courses that are not already enrolled by the student
                            const availableCourses = allCourses.filter(
                                (course) =>
                                    !student.enrolled_courses.some(
                                        (enrolledCourse) =>
                                            enrolledCourse.courseCode === course.courseCode
                                    )
                            );

                            // Render the available courses
                            res.render("courses", {
                                student_name: student_name,
                                courses: availableCourses,
                            });
                        })
                        .catch((err) => {
                            console.error("Error fetching courses:", err);
                            res.status(500).send("An error occurred while fetching courses.");
                        });
                } else {
                    // Unauthorized access
                    res.status(403).send("Access denied. Unauthorized access.");
                }
            })
            .catch((err) => {
                console.error("Error finding student:", err);
                res.status(500).send("Server error.");
            });
    } else {
        res.status(403).send("Access denied. Please log in.");
    }
});

// GET route: View requested courses
app.get("/student/:student_name/req_course_stu", isAuthenticated, isAuthorized("student"), function (req, res) {
    const student_name = req.params.student_name;

    // Ensure the logged-in student is accessing their own data
    if (req.session.userEmail) {
        Student.findOne({ student_name: student_name, student_mail: req.session.userEmail })
            .then((student) => {
                if (student) {
                    // Render the student's requested courses
                    res.render("req_course_stu", {
                        student_name: student_name,
                        courses: student.requested_courses,
                    });
                } else {
                    // Unauthorized access
                    res.status(403).send("Access denied. Unauthorized access.");
                }
            })
            .catch((err) => {
                console.error("Error finding student:", err);
                res.status(500).send("Server error.");
            });
    } else {
        res.status(403).send("Access denied. Please log in.");
    }
});

// POST route: Enroll in a course
app.post("/student/:student_name/enroll", isAuthenticated, isAuthorized("student"), function (req, res) {
    const student_name = req.params.student_name;

    // Ensure the logged-in student is accessing their own data
    if (req.session.userEmail) {
        Student.findOne({ student_name: student_name, student_mail: req.session.userEmail })
            .then((student) => {
                if (student) {
                    // Create the new course object
                    const newCourse = {
                        courseName: req.body.courseName,
                        department: req.body.department,
                        courseCode: req.body.courseCode,
                        description: req.body.description,
                    };
    
                    // Check if the course is already enrolled or requested
                    const isAlreadyEnrolledOrRequested = student.enrolled_courses.some(
                        (course) => course.courseCode === newCourse.courseCode
                    ) || student.requested_courses.some(
                        (course) => course.courseCode === newCourse.courseCode
                    );
    
                    if (!isAlreadyEnrolledOrRequested) {
                        // Add the course to the student's requested courses
                        student.requested_courses.push(newCourse);
    
                        // Save the updated student document
                        student.save()
                            .then(() => {
                                // Find the professor who owns the course
                                return Professor.findOne({
                                    "courses_list.courseCode": newCourse.courseCode,
                                });
                            })
                            .then((professor) => {
                                if (professor) {
                                    const newRequest = {
                                        studentName: student_name,
                                        studentEmail: req.session.userEmail,
                                        courseCode: req.body.courseCode
                                    }
                                    // Add the course to the professor's requests
                                    professor.requests.push(newRequest);
    
                                    // Save the updated professor document
                                    return professor.save();
                                } else {
                                    // Handle the case where the professor is not found
                                    throw new Error("Professor not found for the requested course.");
                                }
                            })
                            .then(() => {
                                // Redirect to the student's dashboard
                                res.redirect(`/student/${student_name}`);
                            })
                            .catch((err) => {
                                console.error("Error updating student or professor:", err);
                                res.status(500).send("An error occurred while processing the enrollment.");
                            });
                    } else {
                        // Redirect to the student's dashboard if already enrolled or requested
                        res.redirect(`/student/${student_name}`);
                    }
                } else {
                    // Unauthorized access
                    res.status(403).send("Access denied. Unauthorized access.");
                }
            })
            .catch((err) => {
                console.error("Error finding student:", err);
                res.status(500).send("Server error.");
            });
    } else {
        res.status(403).send("Access denied. Please log in.");
    }
});


app.listen(3000, function() {
    console.log("Server started on port 3000");
});
