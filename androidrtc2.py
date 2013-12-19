#!/usr/bin/python2.4
#
# Copyright 2011 Google Inc. All Rights Reserved.

# pylint: disable-msg=C6310

"""WebRTC Demo

This module demonstrates the WebRTC API by implementing a simple video chat app.
"""

import cgi
import datetime
import logging
import os
import random
import re
import json
import jinja2
import webapp2
import threading
import time
from google.appengine.api import channel
from google.appengine.ext import db
from google.appengine.api import apiproxy_stub_map
from google.appengine.api import runtime

jinja_environment = jinja2.Environment(
    loader=jinja2.FileSystemLoader(os.path.dirname(__file__)))

# Lock for syncing DB operation in concurrent requests handling.
# TODO(brave): keeping working on improving performance with thread syncing. 
# One possible method for near future is to reduce the message caching.
LOCK = threading.RLock()

def generate_random(len):
  word = ''
  for i in range(len):
    word += random.choice('0123456789')
  return word

def sanitize(key):
    logging.info('sanitize key: ' + key)
    return re.sub('[^a-zA-Z0-9\-]', '-', key)

def make_client_id(room, user):
  return room.key().id_or_name() + '/' + user

def make_pc_config(stun_server, turn_server, ts_pwd):
  servers = []
  if turn_server:
    turn_config = 'turn:{}'.format(turn_server)
    servers.append({'url':turn_config, 'credential':ts_pwd})
  if stun_server:
    stun_config = 'stun:{}'.format(stun_server)
  else:
    stun_config = 'stun:' + 'stun.l.google.com:19302'
  servers.append({'url':stun_config})
  return {'iceServers':servers}

def create_channel(user, duration_minutes):
  #client_id = make_client_id(room, user)
  return channel.create_channel(user, duration_minutes)

def make_loopback_answer(message):
  message = message.replace("\"offer\"", "\"answer\"")
  message = message.replace("a=ice-options:google-ice\\r\\n", "")
  return message

def maybe_add_fake_crypto(message):
  if message.find("a=crypto") == -1:
    index = len(message)
    crypto_line = "a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:BAADBAADBAADBAADBAADBAADBAADBAADBAADBAAD\\r\\n"
    # reverse find for multiple find and insert operations.
    index = message.rfind("c=IN", 0, index) 
    while (index != -1):          
      message = message[:index] + crypto_line + message[index:]
      index = message.rfind("c=IN", 0, index) 
  return message

def register_name (user, name):
    users = Users.gql("WHERE guserid = :userid", userid=user)
    for foundUser in users:
      foundUser.gusername = name;
      foundUser.put()
      logging.info('Registered ' + foundUser.guserid + ' with name ' + foundUser.gusername);
      time.sleep(2)
      update_contact_lists()

def handle_message(user, message):
  logging.info('message is ' + message);
  message_obj = json.loads(message)

  if message_obj['type'] == 'registeration':
      logging.info('Register the user name')
      register_name(user, message_obj['name'])
      return
  if message_obj['type'] == 'call_to':
      logging.info('Making a call to ' + str(message_obj['called_user']));
      logging.info('Wait for it, probabaly more things are going to happen')
  else:
      # some improvement here, place elif
      if message_obj['type'] == 'bye':
          logging.info('A bye messeage');
      if message_obj['type'] == 'offer':
          message = maybe_add_fake_crypto(message)
      if (user==message_obj['called_user']):
          if 'caller' in message_obj:
              other_user = message_obj['caller']
          else:
              other_user = '0'
      elif (user==message_obj['caller']):
          if message_obj['called_user']:
              other_user = message_obj['called_user']
      else:
          logging.info('Unknown user; called_user:' + str(message_obj['called_user']) + ' caller:' + str(message_obj['caller']) + ' conpared user:' + user)
          return
      on_message(other_user, message)

def get_saved_messages(client_id):
  return Message.gql("WHERE client_id = :id", id=client_id)

def delete_saved_messages(client_id):
  messages = get_saved_messages(client_id)
  for message in messages:
    message.delete()
    logging.info('Deleted the saved message for ' + client_id)

def send_saved_messages(client_id):
  messages = get_saved_messages(client_id)
  for message in messages:
    channel.send_message(client_id, message.msg)
    logging.info('Delivered saved message to ' + client_id);
    logging.info('Delivered message is ' + message);
    message.delete()

def on_message(other_user, message):
  channel.send_message(other_user, message)
  logging.info('Delivered message to user ' + other_user);
  logging.info('Delivered message is ' + message);

  """"if room.is_connected(user):
    channel.send_message(client_id, message)
    logging.info('Delivered message to user ' + user);
    logging.info('Delivered message is ' + message);
  else:
    new_message = Message(client_id = client_id, msg = message)
    new_message.put()
    logging.info('Saved message for user ' + user)"""

def make_media_constraints_by_resolution(min_re, max_re):
  constraints = { 'optional': [], 'mandatory': {} }
  if min_re:
    min_sizes = min_re.split('x')
    if len(min_sizes) == 2:
      constraints['mandatory']['minWidth'] = min_sizes[0]
      constraints['mandatory']['minHeight'] = min_sizes[1]
    else:
      logging.info('Ignored invalid min_re: ' + min_re);

  if max_re:
    max_sizes = max_re.split('x')
    if len(max_sizes) == 2:
      constraints['mandatory']['maxWidth'] = max_sizes[0]
      constraints['mandatory']['maxHeight'] = max_sizes[1]
    else:
      logging.info('Ignored invalid max_re: ' + max_re);

  return constraints

def make_pc_constraints(compat):
  constraints = { 'optional': [] }
  # For interop with FireFox. Enable DTLS in peerConnection ctor.
  if compat.lower() == 'true':
    constraints['optional'].append({'DtlsSrtpKeyAgreement': True})
  return constraints

def make_offer_constraints(compat):
  constraints = { 'mandatory': {}, 'optional': [] }
  # For interop with FireFox. Disable Data Channel in createOffer.
  if compat.lower() == 'true':
    constraints['mandatory']['MozDontOfferDataChannel'] = True
  return constraints

def append_url_arguments(request, link):
  for argument in request.arguments():
    if argument != 'r':
      link += ('&' + cgi.escape(argument, True) + '=' +
                cgi.escape(request.get(argument), True))
  return link

# This database is to store the messages from the sender client when the
# receiver client is not ready to receive the messages.
# Use TextProperty instead of StringProperty for msg because
# the session description can be more than 500 characters.
class Message(db.Model):
  client_id = db.StringProperty()
  msg = db.TextProperty()

class Users(db.Model):
    gusername = db.StringProperty()
    guserid = db.StringProperty()

class Room(db.Model):
  """All the data we store for a room"""
  user1 = db.StringProperty()
  user2 = db.StringProperty()
  user1_connected = db.BooleanProperty(default=False)
  user2_connected = db.BooleanProperty(default=False)

  def __str__(self):
    str = '['
    if self.user1:
      str += "%s-%r" % (self.user1, self.user1_connected)
    if self.user2:
      str += ", %s-%r" % (self.user2, self.user2_connected)
    str += ']'
    return str

  def get_occupancy(self):
    occupancy = 0
    if self.user1:
      occupancy += 1
    if self.user2:
      occupancy += 1
    return occupancy

  def get_other_user(self, user):
    if user == self.user1:
      return self.user2
    elif user == self.user2:
      return self.user1
    else:
      return None

  def has_user(self, user):
    return (user and (user == self.user1 or user == self.user2))

  def add_user(self, user):
    if not self.user1:
      self.user1 = user
    elif not self.user2:
      self.user2 = user
    else:
      raise RuntimeError('room is full')
    self.put()

  def remove_user(self, user):
    delete_saved_messages(make_client_id(self, user))
    if user == self.user2:
      self.user2 = None
      self.user2_connected = False
    if user == self.user1:
      if self.user2:
        self.user1 = self.user2
        self.user1_connected = self.user2_connected
        self.user2 = None
        self.user2_connected = False
      else:
        self.user1 = None
        self.user1_connected = False
    if self.get_occupancy() > 0:
      self.put()
    else:
      self.delete()

  def set_connected(self, user):
    if user == self.user1:
      self.user1_connected = True
    if user == self.user2:
      self.user2_connected = True
    self.put()

  def is_connected(self, user):
    if user == self.user1:
      return self.user1_connected
    if user == self.user2:
      return self.user2_connected

class ConnectPage(webapp2.RequestHandler):
  def post(self):
    logging.info('ConnectPage::post ')
    user = self.request.get('from')
    logging.info('ConnectPage key: ' + str(user))
    update_contact_lists()

class DisconnectPage(webapp2.RequestHandler):
  def post(self):
    user = self.request.get('from')
    #room_key, user = key.split('/')
    with LOCK:
      userids = Users.gql("WHERE guserid = :userid", userid=user)
      for userid in userids:
        logging.info('Deleting user ' + userid.guserid)
        userid.delete()
        foundUser = 'true';

      if not (foundUser=='true'):
        logging.info('UNEXPECTED - Could not find ' + user)

      # If the disconnected user was in a call, send bye message to the other user
    logging.warning('User ' + user + ' disconnected.')
    time.sleep(3)
    update_contact_lists()

class MessagePage(webapp2.RequestHandler):
  def post(self):
    logging.info('MessagePage::post ')
    message = self.request.body
    user = self.request.get('u')
    logging.info('MessagePage post user' + user)
    # logging.info('Message is ' + message)
    with LOCK:
      # room = Room.get_by_key_name(room_key)
      # logging.info('MessagePage post room ' + str(room))
      if user:
        handle_message(user, message)
      else:
        logging.warning('Unknown user ' + user)

def update_contact_lists():
    contacts = Users.gql("WHERE guserid != 'a'")
    contactList = list()
    for contact in contacts:
        logging.info(contact.gusername)
        if (contact.gusername==contact.guserid):
          contactList.append(contact.gusername.encode("ascii"))
        else:
          contactList.append(contact.gusername.encode("ascii") + "-" + contact.guserid.encode("ascii"))
    contact_values = {'type': 'contact_list', 'usernames': contactList}
    for contact in contacts:
        logging.info('sending to ' + contact.guserid + ', message is ' + json.dumps(contact_values))
        channel.send_message(contact.guserid, json.dumps(contact_values))

class MainPage(webapp2.RequestHandler):
  """The main UI page, renders the 'index.html' template."""
  def get(self):
    """Renders the main page. When this page is shown, we create a new
    channel to push asynchronous updates to the client."""
    # get the base url without arguments.
    base_url = self.request.path_url
    #room_key = sanitize(self.request.get('r'))
    #logging.info('MainPage room_key=' + room_key)
    debug = self.request.get('debug')
    unittest = self.request.get('unittest')
    stun_server = self.request.get('ss')
    turn_server = self.request.get('ts')
    min_re = self.request.get('minre')
    max_re = self.request.get('maxre')
    hd_video = self.request.get('hd')
    if hd_video.lower() == 'true':
      min_re = '1280x720'
    ts_pwd = self.request.get('tp')
    # set compat to true by default.
    compat = 'true'
    if self.request.get('compat'):
      compat = self.request.get('compat')
    if debug == 'loopback':
    # set compat to false as DTLS does not work for loopback.
      compat = 'false'


    # token_timeout for channel creation, default 30min, max 2 days, min 3min.
    token_timeout = self.request.get_range('tt',
                                           min_value = 3,
                                           max_value = 3000,
                                           default = 30)

    if unittest:
      # Always create a new room for the unit tests.
      room_key = generate_random(8)

    # Database does not sync fast enough
    #time.sleep(2)

    user = None
    initiator = 0
    with LOCK:
      if not initiator: # temporary - remove this
        user = generate_random(8) #'Busra-Yusuf' #

        logging.info('user = ' + user)
        new_user = Users(gusername = user, guserid = user)
        logging.info('Insert username to the database')
        new_user.put()

        time.sleep(2)
        update_contact_lists()

        logging.info('Usernames are:')
        contacts = Users.gql("WHERE guserid != 'a'")
        contactList = list()
        i =0;
        for contact in contacts:
            logging.info(contact.gusername)
            if (contact.gusername==contact.guserid):
              contactList.append(contact.gusername.encode("ascii"))
            else:
              contactList.append(contact.gusername.encode("ascii") + "-" + contact.guserid.encode("ascii"))

        if debug != 'loopback':
          initiator = 0
        else:
          initiator = 1
    token = create_channel(user, token_timeout)
    pc_config = make_pc_config(stun_server, turn_server, ts_pwd)
    pc_constraints = make_pc_constraints(compat)
    offer_constraints = make_offer_constraints(compat)
    media_constraints = make_media_constraints_by_resolution(min_re, max_re)
    template_values = {'channelToken': token,
                       'me': user,
                       'initiator': initiator,
                       'usernames': contactList,
                       'pc_config': json.dumps(pc_config),
                       'pc_constraints': json.dumps(pc_constraints),
                       'offer_constraints': json.dumps(offer_constraints),
                       'media_constraints': json.dumps(media_constraints)
                      }

    logging.info('template values: ' + str(template_values))

    if unittest:
      target_page = 'test/test_' + unittest + '.html'
    else:
      target_page = 'index.html'

    template = jinja_environment.get_template(target_page)
    logging.info('template with values: ' + str (template.render(template_values)))
    self.response.out.write(template.render(template_values))

app = webapp2.WSGIApplication([
    ('/', MainPage),
    ('/message', MessagePage),
    ('/_ah/channel/connected/', ConnectPage),
    ('/_ah/channel/disconnected/', DisconnectPage)
  ], debug=True)
