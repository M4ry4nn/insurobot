'use strict';

const
    bodyParser = require('body-parser'),
    config = require('config'),
    crypto = require('crypto'),
    express = require('express'),
    https = require('https'),
    request = require('request'),
    apiai = require("apiai"),
    mongodb = require("mongodb"),
    _ = require('lodash'),
    async = require('async');


var app = express();
app.set('port', process.env.PORT || 5000);
app.set('view engine', 'ejs');
app.use(bodyParser.json({verify: verifyRequestSignature}));
app.use(express.static('public'));


// App Secret can be retrieved from the App Dashboard
const APP_SECRET = (process.env.MESSENGER_APP_SECRET) ?
    process.env.MESSENGER_APP_SECRET :
    config.get('appSecret');

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
    (process.env.MESSENGER_VALIDATION_TOKEN) :
    config.get('validationToken');

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
    (process.env.MESSENGER_PAGE_ACCESS_TOKEN) :
    config.get('pageAccessToken');

// URL where the app is running (include protocol). Used to point to scripts and 
// assets located at this address. 
const SERVER_URL = (process.env.SERVER_URL) ?
    (process.env.SERVER_URL) :
    config.get('serverURL');

const API_AI_SCCESS_TOKEN = (process.env.API_AI_SCCESS_TOKEN) ?
    (process.env.API_AI_SCCESS_TOKEN) :
    config.get('apiAiAccessToken');

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && SERVER_URL)) {
    console.error("Missing config values");
    process.exit(1);
}

let chatbot = apiai(API_AI_SCCESS_TOKEN);

let STARTER_TYPES = ["CLAIM_REPORT", "EMERGENCY_AGENT", "COVERAGE_CHECK", "ACHIEVEMENTS"];
let OFFER_TYPES = ["BUY_INSURANCE_1", "BUY_INSURANCE_2", "BUY_INSURANCE_3"];
let PAYMENT_OPTIONS = ["PAYMENT_YES", "PAYMENT_NO"];


app.get('/webhook', function (req, res) {
    if (req.query['hub.mode'] === 'subscribe' &&
        req.query['hub.verify_token'] === VALIDATION_TOKEN) {
        console.log("Validating webhook");
        res.status(200).send(req.query['hub.challenge']);
    } else {
        console.error("Failed validation. Make sure the validation tokens match.");
        res.sendStatus(403);
    }
});


app.post('/webhook', function (req, res) {
    var data = req.body;

    // Make sure this is a page subscription
    if (data.object == 'page') {
        // Iterate over each entry
        // There may be multiple if batched
        data.entry.forEach(function (pageEntry) {
            var pageID = pageEntry.id;
            var timeOfEvent = pageEntry.time;

            // Iterate over each messaging event
            pageEntry.messaging.forEach(function (messagingEvent) {
                if (messagingEvent.optin) {
                    receivedAuthentication(messagingEvent);
                } else if (messagingEvent.message) {
                    receivedMessage(messagingEvent);
                } else if (messagingEvent.delivery) {
                    receivedDeliveryConfirmation(messagingEvent);
                } else if (messagingEvent.postback) {
                    receivedPostback(messagingEvent);
                } else if (messagingEvent.read) {
                    receivedMessageRead(messagingEvent);
                } else if (messagingEvent.account_linking) {
                    receivedAccountLink(messagingEvent);
                } else {
                    console.log("Webhook received unknown messagingEvent: ", messagingEvent);
                }
            });
        });

        // Assume all went well.
        //
        // You must send back a 200, within 20 seconds, to let us know you've
        // successfully received the callback. Otherwise, the request will time out.
        res.sendStatus(200);
    }
});


function verifyRequestSignature(req, res, buf) {
    var signature = req.headers["x-hub-signature"];

    if (!signature) {
        // For testing, let's log an error. In production, you should throw an
        // error.
        console.error("Couldn't validate the signature.");
    } else {
        var elements = signature.split('=');
        var method = elements[0];
        var signatureHash = elements[1];

        var expectedHash = crypto.createHmac('sha1', APP_SECRET)
            .update(buf)
            .digest('hex');

        if (signatureHash != expectedHash) {
            throw new Error("Couldn't validate the request signature.");
        }
    }
}

function receivedAuthentication(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfAuth = event.timestamp;

    // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
    // The developer can set this to an arbitrary value to associate the
    // authentication callback with the 'Send to Messenger' click event. This is
    // a way to do account linking when the user clicks the 'Send to Messenger'
    // plugin.
    var passThroughParam = event.optin.ref;

    console.log("Received authentication for user %d and page %d with pass " +
        "through param '%s' at %d", senderID, recipientID, passThroughParam,
        timeOfAuth);

    // When an authentication is received, we'll send a message back to the sender
    // to let them know it was successful.
    sendTextMessage(senderID, "Authentication successful");
}


function receivedMessage(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfMessage = event.timestamp;
    var message = event.message;

    // db.collection(SENDER_COLLECTION).insertOne({age: 17}, {$set:{name:"Naomi"}}, function(err, doc) {
    //     if (err) {
    //         handleError(res, err.message, "Failed to create new sender.");
    //     } else {
    //         res.status(201).json(doc.ops[0]);
    //     }
    // });

    console.log("Received message for user %d and page %d at %d with message:",
        senderID, recipientID, timeOfMessage);
    console.log(JSON.stringify(message));

    var isEcho = message.is_echo;
    var messageId = message.mid;
    var appId = message.app_id;
    var metadata = message.metadata;

    // You may get a text or attachment but not both
    var messageText = message.text;
    var messageAttachments = message.attachments;
    var quickReply = message.quick_reply;

    if (isEcho) {
        // Just logging message echoes to console
        console.log("Received echo for message %s and app %d with metadata %s",
            messageId, appId, metadata);
        return;
    } else if (quickReply) {
        var quickReplyPayload = quickReply.payload;
        console.log("Quick reply for message %s with payload %s",
            messageId, quickReplyPayload);

        sendTextMessage(senderID, "Quick reply tapped");
        return;
    }

    if (messageText) {

        // If we receive a text message, check to see if it matches any special
        // keywords and send back the corresponding example. Otherwise, just echo
        // the text we received.
        switch (messageText) {
            case 'image':
                sendImageMessage(senderID);
                break;

            case 'gif':
                sendGifMessage(senderID);
                break;

            case 'audio':
                sendAudioMessage(senderID);
                break;

            case 'video':
                sendVideoMessage(senderID);
                break;

            case 'file':
                sendFileMessage(senderID);
                break;

            case 'button':
                sendButtonMessage(senderID);
                break;

            case 'generic':
                sendGenericMessage(senderID);
                break;

            case 'receipt':
                sendReceiptMessage(senderID);
                break;

            case 'quick reply':
                sendQuickReply(senderID);
                break;

            case 'read receipt':
                sendReadReceipt(senderID);
                break;

            case 'typing on':
                sendTypingOn(senderID);
                break;

            case 'typing off':
                sendTypingOff(senderID);
                break;

            case 'account linking':
                sendAccountLinking(senderID);
                break;

            default:

                processApiDotAiRequest(messageText, senderID);

        }
    } else if (messageAttachments) {
        console.log(messageAttachments);
        if (messageAttachments[0].type === "image") {

            console.log("got your imgae");
            var imgUrl = messageAttachments[0].payload.url;
            console.log(imgUrl);

            var bodyObject = {
                'url': imgUrl
            };
            console.log("--------------------------------------------------------" + JSON.stringify(bodyObject));

            request.post({
                    headers: {'content-type': 'application/json'},
                    url: 'https://hackzurich2016.herokuapp.com/dude',
                    body: JSON.stringify(bodyObject)
                },
                function (error, response, body) {
                    console.log("--------------------------------------------------------" + body);
                    var arr = JSON.parse(body);

                    var obj = {"REPORT-CLAIM-IMAGE": arr[0]};
                    console.log("-------------------------------------------------------OBJ" + obj);

                    processApiDotAiRequest(JSON.stringify(obj), senderID);


                    // send pic to api.ai with contracted format

                });
        }

    }
}


function processApiDotAiRequest(messageText, senderID) {

    var requestBot = chatbot.textRequest(messageText);
    requestBot.on('response', function (response) {
        console.log("Here you got the answer: ");
        console.log(response);
        checkForOfferResponse(response, senderID);
        sendTextMessage(senderID, response.result.fulfillment.speech);
    });

    requestBot.on('error', function (error) {
        console.log(error);
    });

    requestBot.end();

}

function checkForOfferResponse(response, senderID) {

    if (response.result.metadata.intentName === "insurance.coverage.upgrade-yes") {

        sendGenericMessage(senderID);

    }


}


function receivedDeliveryConfirmation(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var delivery = event.delivery;
    var messageIDs = delivery.mids;
    var watermark = delivery.watermark;
    var sequenceNumber = delivery.seq;

    if (messageIDs) {
        messageIDs.forEach(function (messageID) {
            console.log("Received delivery confirmation for message ID: %s",
                messageID);
        });
    }

    console.log("All message before %d were delivered.", watermark);
}


function receivedPostback(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfPostback = event.timestamp;

    // The 'payload' param is a developer-defined field which is set in a postback
    // button for Structured Messages.
    var payload = event.postback.payload;

    if (payload === "START_CONVERSATION") {

        sendTextMessage(senderID, "Ok, let's start.");

        sendAccountLinking(senderID);


        // TODO callback ---> {action: "report-claim, check-coverage, usw.", userdata: "adrian"};

        // TODO get userdata


    }
    else if (_.includes(STARTER_TYPES, payload)) {

        // got the postback back from the button click at the start

        if (payload === STARTER_TYPES[0]) {
            sendInputChooseMessage(senderID);

        } else if (payload === STARTER_TYPES[3]) {
            sendTextMessage(senderID, "We're gonna place some gamification elements here like: check your window wipers or fire extinguisher and collect points");
            sendGifMessage(senderID);


        }

    }
    else if (_.includes(PAYMENT_OPTIONS, payload)) {

        sendReceiptMessage(senderID);
        var millisecondsToWait = 1000;
        setTimeout(function () {
            sendTextMessage(senderID, "Payment completed! That was simple, wasn't it?");


        }, millisecondsToWait);

        setTimeout(function () {
            sendTextMessage(senderID, "If you need anything else just text me :)");

        }, 1500);

    }

    else if (_.includes(OFFER_TYPES, payload)) {
        sendPaymentDataButton(senderID);
    }

    else if (payload === "IMAGE_INPUT") {
        sendTextMessage(senderID, "Ok, just send me a picture of the affected object.");

    }

    else {

        console.log("Received postback for user %d and page %d with payload '%s' " +
            "at %d", senderID, recipientID, payload, timeOfPostback);

        // When a postback is called, we'll send a message back to the sender to
        // let them know it was successful
        sendTextMessage(senderID, "Postback called");

    }

}

function receivedMessageRead(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;

    // All messages before watermark (a timestamp) or sequence have been seen.
    var watermark = event.read.watermark;
    var sequenceNumber = event.read.seq;

    console.log("Received message read event for watermark %d and sequence " +
        "number %d", watermark, sequenceNumber);
}


function receivedAccountLink(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;

    var status = event.account_linking.status;
    var authCode = event.account_linking.authorization_code;

    console.log("Received account link event with for user %d with status %s " +
        "and auth code %s ", senderID, status, authCode);

    sendStarterMessage(senderID);
}

/*
 * Send an image using the Send API.
 *
 */
function sendImageMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "image",
                payload: {
                    url: SERVER_URL + "/assets/rift.png"
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a Gif using the Send API.
 *
 */
function sendGifMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "image",
                payload: {
                    url: SERVER_URL + "/assets/giphy.gif"
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send audio using the Send API.
 *
 */
function sendAudioMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "audio",
                payload: {
                    url: SERVER_URL + "/assets/sample.mp3"
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 *
 */
function sendVideoMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "video",
                payload: {
                    url: SERVER_URL + "/assets/allofus480.mov"
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 *
 */
function sendFileMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "file",
                payload: {
                    url: SERVER_URL + "/assets/test.txt"
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage(recipientId, messageText) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: messageText,
            metadata: "DEVELOPER_DEFINED_METADATA"
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "This is test text",
                    buttons: [{
                        type: "web_url",
                        url: "https://www.oculus.com/en-us/rift/",
                        title: "Open Web URL"
                    }, {
                        type: "postback",
                        title: "Trigger Postback",
                        payload: "DEVELOPED_DEFINED_PAYLOAD"
                    }, {
                        type: "phone_number",
                        title: "Call Phone Number",
                        payload: "+16505551234"
                    }]
                }
            }
        }
    };

    callSendAPI(messageData);
}

function sendPaymentDataButton(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "Are you sure you want to complete the payment?",
                    buttons: [{
                        type: "postback",
                        title: "Yes, pay!",
                        payload: "PAYMENT_YES"
                    }, {
                        type: "postback",
                        title: "No, cancel it!",
                        payload: "PAYMENT_NO"
                    }]
                }
            }
        }
    };

    callSendAPI(messageData);
}


function sendStarterMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "How can I help you?",
                    buttons: [{
                        type: "postback",
                        title: "Report a claim",
                        payload: "CLAIM_REPORT"
                    }, {
                        type: "postback",
                        title: "Achievements",
                        payload: "ACHIEVEMENTS"
                    }, {
                        type: "postback",
                        title: "Emergency assistance",
                        payload: "EMERGENCY_AGENT"
                    }]
                }
            }
        }
    };
    callSendAPI(messageData);
    console.log("------------------------Sent buttons");
}


function sendInputChooseMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "Ok, how would you like to describe your claim?",
                    buttons: [{
                        type: "postback",
                        title: "Image",
                        payload: "IMAGE_INPUT"
                    }, {
                        type: "postback",
                        title: "Text",
                        payload: "TEXT_INPUT"
                    }]
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a Structured Message (Generic Message type) using the Send API.
 *
 */
function sendGenericMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "generic",
                    elements: [
                        {
                            title: "Minimum",
                            subtitle: "basic coverage",
                            item_url: "www.myinsurance.ch",
                            image_url: SERVER_URL + "/assets/1dollar.png",
                            buttons: [{
                                type: "web_url",
                                url: "http://www.sombreromex.com/",
                                title: "get more information"
                            }, {
                                type: "postback",
                                title: "Buy it", //TODO 3 bullets with coverage, price
                                payload: "BUY_INSURANCE_3",
                            }],
                        }, {
                            title: "Standard",
                            subtitle: "basic coverage",
                            item_url: "www.myinsurance.ch",
                            image_url: SERVER_URL + "/assets/2dollar.png",
                            buttons: [{
                                type: "web_url",
                                url: "http://www.sombreromex.com/",
                                title: "get more information"
                            }, {
                                type: "postback",
                                title: "Buy it",
                                payload: "BUY_INSURANCE_2",
                            }],
                        }, {
                            title: "Premium",
                            subtitle: "additional support in case of a claim",
                            item_url: "www.myinsurance.ch",
                            image_url: SERVER_URL + "/assets/3dollar.png",
                            buttons: [{
                                type: "web_url",
                                url: "http://www.sombreromex.com/",
                                title: "get more information"
                            }, {
                                type: "postback",
                                title: "Buy it",
                                payload: "BUY_INSURANCE_1",
                            }]
                        }]
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a receipt message using the Send API.
 *
 */
function sendReceiptMessage(recipientId) {
    // Generate a random receipt ID as the API requires a unique ID
    var receiptId = "order" + Math.floor(Math.random() * 1000);

    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "receipt",
                    recipient_name: "Adrian Krebs", //TODO add usersername here
                    order_number: receiptId,
                    currency: "USD",
                    payment_method: "Visa 1234",
                    timestamp: "1428444852",
                    elements: [{
                        title: "Insurance payment for 12 month",
                        subtitle: "Includes: fire and water damage",
                        quantity: 1,
                        price: 599.00,
                        currency: "USD",
                        image_url: SERVER_URL + "/assets/1dollar.png"
                    }, {
                        title: "Customer participation",
                        subtitle: "basic",
                        quantity: 1,
                        price: 99.99,
                        currency: "USD",
                        image_url: SERVER_URL + "/assets/1dollar.png"
                    }],
                    address: {
                        street_1: "Technoparkstrasse 1",
                        street_2: "",
                        city: "Zurich",
                        postal_code: "8005",
                        state: "ZH",
                        country: "CH"
                    },
                    summary: {
                        subtotal: 698.99,
                        shipping_cost: 20.00,
                        total_tax: 57.67,
                        total_cost: 626.66
                    },
                    adjustments: [{
                        name: "New Customer Discount",
                        amount: -50
                    }, {
                        name: "$100 Off Coupon",
                        amount: -100
                    }]
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendQuickReply(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: "What's your favorite movie genre?",
            metadata: "DEVELOPER_DEFINED_METADATA",
            quick_replies: [
                {
                    "content_type": "text",
                    "title": "Action",
                    "payload": "DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_ACTION"
                },
                {
                    "content_type": "text",
                    "title": "Comedy",
                    "payload": "DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_COMEDY"
                },
                {
                    "content_type": "text",
                    "title": "Drama",
                    "payload": "DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_DRAMA"
                }
            ]
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {
    console.log("Sending a read receipt to mark message as seen");

    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "mark_seen"
    };

    callSendAPI(messageData);
}

/*
 * Turn typing indicator on
 *
 */
function sendTypingOn(recipientId) {
    console.log("Turning typing indicator on");

    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "typing_on"
    };

    callSendAPI(messageData);
}

/*
 * Turn typing indicator off
 *
 */
function sendTypingOff(recipientId) {
    console.log("Turning typing indicator off");

    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "typing_off"
    };

    callSendAPI(messageData);
}

/*
 * Send a message with the account linking call-to-action
 *
 */
function sendAccountLinking(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "Sign in to your insurance account, so I can get your contracts and insurance policies",
                    buttons: [{
                        type: "account_link",
                        url: SERVER_URL + "/authorize"
                    }]
                }
            }
        }
    };

    callSendAPI(messageData);
}


app.get('/authorize', function (req, res) {
    var accountLinkingToken = req.query['account_linking_token'];
    var redirectURI = req.query['redirect_uri'];

    // Authorization Code should be generated per user by the developer. This will
    // be passed to the Account Linking callback.
    var authCode = "1234567890";

    // Redirect users to this URI on successful login
    var redirectURISuccess = redirectURI + "&authorization_code=" + authCode;

    res.render('authorize', {
        accountLinkingToken: accountLinkingToken,
        redirectURI: redirectURI,
        redirectURISuccess: redirectURISuccess
    });
});

/*
 * Call the Send API. The message data goes in the body. If successful, we'll 
 * get the message id in a response 
 *
 */
function callSendAPI(messageData) {
    request({
        uri: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {access_token: PAGE_ACCESS_TOKEN},
        method: 'POST',
        json: messageData

    }, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var recipientId = body.recipient_id;
            var messageId = body.message_id;

            if (messageId) {
                console.log("Successfully sent message with id %s to recipient %s",
                    messageId, recipientId);
                console.log(messageData);
            } else {
                console.log("Successfully called Send API for recipient %s",
                    recipientId);
            }
        } else {
            console.error(response.error);
        }
    });
}

// Start server
// Webhooks must be available via SSL with a certificate signed by a valid 
// certificate authority.
app.listen(app.get('port'), function () {
    console.log('Node app is running on port', app.get('port'));
});

module.exports = app;

