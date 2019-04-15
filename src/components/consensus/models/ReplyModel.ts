import {PacketModel} from './PacketModel';

class ReplyModel {

    public reply: PacketModel;
    public who: string|number|string[];

    constructor(reply: PacketModel, who: string|number|string[]) {
        this.reply = reply;
        this.who = who;
    }
}

export {ReplyModel};
