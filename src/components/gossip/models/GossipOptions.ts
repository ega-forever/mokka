class GossipOptions {
    public readonly heartbeat: number;
    public readonly timeout: number;

    // @ts-ignore
    constructor({timeout, heartbeat}) {
        this.heartbeat = heartbeat;
        this.timeout = timeout;

    }

}

export {GossipOptions};
