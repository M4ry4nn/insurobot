/**
 * Created by Adrian on 9/6/2016.
 */


'use strict';

const
    config = require('config'),
    clarifai = require('clarifai');

const CLARIFAI_CLIENT_ID = (process.env.CLARIFAI_CLIENT_ID) ?
    (process.env.CLARIFAI_CLIENT_ID) :
    config.get('clarifaiClientId');
const CLARIFAI_CLIENT_SECRET = (process.env.CLARIFAI_CLIENT_SECRET) ?
    (process.env.CLARIFAI_CLIENT_SECRET) :
    config.get('clarifaiClientSecret');


clarifai.initialize({
    'clientId': CLARIFAI_CLIENT_ID,
    'clientSecret': CLARIFAI_CLIENT_SECRET
});


module.exports.getTags = function (url) {
    return clarifai.getTagsByUrl(url);
};

