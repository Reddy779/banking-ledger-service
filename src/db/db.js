const mongoose = require('mongoose')

async function connectToDB() {
    mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("Server is connected to DB")
    })
    .catch(err => {
        console.log("Error while connecting to DB")
    })
}


module.exports = connectToDB;