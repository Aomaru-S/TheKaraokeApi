const express = require('express');
const logger = require('morgan');

const indexRouter = require('./routes/index');

const app = express();

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({extended: false}));

app.use('/', indexRouter)

app.use(function (request, response, next) {
    response.status(404).json({error: 404});
});

module.exports = app;