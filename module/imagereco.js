/**
 * Created by Adrian on 9/17/2016.
 */
'use strict';


/**
 * pew pew this module is used to interact with clarifai --> may call a extrernal service here
 */

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


module.exports.getTags = function(url) {
    clarifai.getTagsByUrl(
        url).then(
        handleResponse,
        handleError
    );
};


function handleResponse(response){
    console.log('promise response:', JSON.stringify(response));
};

function handleError(err){
    console.log('promise error:', err);
};
