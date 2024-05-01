const getUrls = require("get-urls");
const { Collection } = require("@discordjs/collection");
const Util = require("../utils/Util");
const Message = require("./Message");
const Attachment = require("./Attachment");
const Client = require("./Client");

/**
 * Represents a chat between one or more users.
 */
class Chat {
  /**
   * @param {Client} client The instantiating client
   * @param {string} threadID The ID of the thread
   * @param {object} data The data for the chat
   */
  constructor(client, threadID, data) {
    /**
     * @type {Client}
     * The client that instantiated this
     */
    this.client = client;
    /**
     * @type {string}
     * The ID of the chat
     */
    this.id = threadID;
    /**
     * @type {Collection<string, Message>}
     * The messages in the chat.
     */
    this.messages = new Collection();
    /**
     * @type {Collection<string, User>}
     * The users in the chat.
     */
    this.users = new Collection();
    /**
     * @type {Collection<string, User>}
     * The users that left the chat.
     */
    this.leftUsers = new Collection();
    /**
     * @type {boolean}
     * Whether the client is typing in the chat.
     */
    this.typing = false;

    this._disableTypingOnSend = null;
    this._stopTypingTimeout = null;
    this._keepTypingAliveInterval = null;
    this._sentMessagesPromises = new Collection();

    this._patch(data);
  }

  get threadEntity() {
    return this.client.ig.entity.directThread(this.id);
  }

  
  _patch(data) {
    if ("users" in data) {
      this.users = new Collection();
      data.users.forEach((user) => {
        this.users.set(user.pk, this.client._patchOrCreateUser(user.pk, user));
      });
    }
    if ("left_users" in data) {
      this.leftUsers = new Collection();
      data.left_users.forEach((user) => {
        this.leftUsers.set(
          user.pk,
          this.client._patchOrCreateUser(user.pk, user)
        );
      });
    }
    if ("items" in data) {
      this.messages = new Collection();
      data.items.forEach((item) => {
        this.messages.set(
          item.item_id,
          new Message(this.client, this.id, item)
        );
      });
    }

    /**
     * @type {string[]}
     * The IDs of the administrators of the chat.
     */
    this.adminUserIDs =
      "admin_user_ids" in data ? data.admin_user_ids : this.adminUserIDs;
    /**
     * @type {number}
     * The last time the chat was active.
     */
    this.lastActivityAt =
      "last_activity_at" in data ? data.last_activity_at : this.lastActivityAt;
    /**
     * @type {boolean}
     * Whether the account has muted the chat.
     */
    this.muted = "muted" in data ? data.muted : this.muted;
    /**
     * @type {boolean}
     * Whether the account has pinned the chat.
     */
    this.isPin = "is_pin" in data ? data.is_pin : this.isPin;
    /**
     * @type {boolean}
     * Whether this chat has a specific name (otherwise it's the default name).
     */
    this.named = "named" in data ? data.named : this.named;
    /**
     * @type {string}
     * The name of the chat
     */
    this.name = "thread_title" in data ? data.thread_title : this.name;
    /**
     * @type {boolean}
     * Whether the chat is waiting for the account approval.
     */
    this.pending = "pending" in data ? data.pending : this.pending;
    /**
     * @type {boolean}
     * Whether the chat is a group.
     */
    this.isGroup = "is_group" in data ? data.is_group : this.isGroup;
    /**
     * @type {boolean}
     * The type of the chat.
     */
    this.type = "thread_type" in data ? data.thread_type : this.type;
    /**
     * @type {boolean}
     * If a call is ongoing in this chat.
     */
    this.calling = "video_call_id" in data;
  }
  /**
   * Approve the chat if it's pending.
   * @returns {Promise<void>}
   */
  async approve() {
    this.pending = false;
    await this.client.ig.directThread.approve(this.id);
    if (!this.client.cache.chats.has(this.id))
      this.client.cache.chats.set(this.id, this);
    this.client.cache.pendingChats.delete(this.id);
    if (Util.isMessageValid(this.messages.first()))
      this.client.emit("messageCreate", this.messages.first());
  }

  /**
   * Mark a message of the chat as seen
   * @param {string} messageID The ID of the message to mark as seen
   * @returns {Promise<void>}
   */
  async messageSeen(messageID) {
    await this.threadEntity.markItemSeen(messageID);
  }

  /**
   * Delete a message of the chat
   * @param {string} messageID The ID of the message to delete
   * @returns {Promise<void>}
   */
  async deleteMessage(messageID) {
    await this.threadEntity.deleteItem(messageID);
  }

  
  async _keepTypingAlive() {
    if (this.typing) {
      await this.client.ig.realtime.direct.indicateActivity({
        threadId: this.id,
        isActive: true,
      });
    } else if (this._keepTypingAliveInterval)
      clearInterval(this._keepTypingAliveInterval);
  }
  /**
   * Start typing in the chat
   * @param {number} [options] Options
   * @param {number} [options.duration=10000] For how long the client should type
   * @param {boolean} [options.disableOnSend=true] Whether the bot should stop typing when it sends a new message
   * @returns {Promise<void>}
   */

  async startTyping({ duration, disableOnSend } = {}) {
    this.typing = true;
    await this.client.ig.realtime.direct.indicateActivity({
      threadId: this.id,
      isActive: true,
    });
    this._disableTypingOnSend =
      disableOnSend !== undefined ? disableOnSend : true;
    this._stopTypingTimeout = setTimeout(
      () => this.stopTyping(),
      duration || 10000
    );
    this._keepTypingAliveInterval = setInterval(
      () => this._keepTypingAlive(),
      9000
    );
  }

  /**
   * Stop typing in the chat
   * @returns {Promise<void>}
   */
  async stopTyping() {
    if (this._keepTypingAliveInterval)
      clearTimeout(this._keepTypingAliveInterval);
    this.typing = false;
    await this.client.ig.realtime.direct.indicateActivity({
      threadId: this.id,
      isActive: false,
    });
  }

  /**
   * Send a message & photo in the chat
   * @param {string} content The content of the message to send
   * @param {string|Buffer|Attachment} attachment The photo to send
   * @returns {Promise<Message>}

   * @example
   * Send Message With Attchment
   * chat.send({ content: 'hey!', attachment: 'https://via.placeholder.com/150'});
   * 
   * Only Send Message
   *  chat.send('hey!');
   * 
   * Only Send Attchment
   * chat.send({ attachment: 'https://via.placeholder.com/150'});
   */

  send(content, attachment) {
    if (typeof content === 'object' && content !== null) {
      // If it's an object, extract content and attachment from it
      const { content: objContent, attachment: objAttachment } = content;
      content = objContent;
      attachment = objAttachment;
    }
    return new Promise((resolve) => {
      let delay = 0;
      if (attachment) {
        delay = 3000;
        if (!(attachment instanceof Attachment)) {
          attachment = new Attachment(attachment);
        }
        attachment._verify().then(() => {
          this.threadEntity
            .broadcastPhoto({ file: attachment.file })
            .then(({ item_id: itemID }) => {
              if (this.typing && !this._disableTypingOnSend)
                this._keepTypingAlive();
              this._sentMessagesPromises.set(itemID, resolve);
            });
        });
      }
      setTimeout(() => {
         if (content && typeof content === 'string') {
        const urls = getUrls(content);
        const promise = urls.size >= 1 ?
          this.threadEntity.broadcastText(content, Array.from(urls)) :
          this.threadEntity.broadcastText(content);
  
        promise.then(({ item_id: itemID }) => {
          if (this.typing && !this._disableTypingOnSend)
            this._keepTypingAlive();
          this._sentMessagesPromises.set(itemID, resolve);
        });
      }
    }, delay)
    });
  }
  

  toJSON() {
    return {
      adminUserIDs: this.adminUserIDs,
      lastActivityAt: this.lastActivityAt,
      muted: this.muted,
      isPin: this.isPin,
      named: this.named,
      pending: this.pending,
      isGroup: this.isGroup,
      calling: this.calling,
      users: this.users.map((u) => u.id),
      messages: this.messages.map((m) => m.id),
    };
  }
}

module.exports = Chat;
