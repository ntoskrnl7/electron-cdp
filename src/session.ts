import EventEmitter from 'events';
import ProtocolMapping from 'devtools-protocol/types/protocol-mapping';
import { BrowserWindow, Debugger } from 'electron';
import { ExecutionContext } from './executionContext';
import Protocol from 'devtools-protocol';

export declare interface CommandOptions {
    timeout: number;
}

export declare type Events = {
    [Property in keyof ProtocolMapping.Events]: ProtocolMapping.Events[Property];
} & {
    'executionContextCreated': [ExecutionContext];
};

export class Session extends EventEmitter<Events> {

    readonly window: BrowserWindow;
    #debugger: Debugger;

    constructor(window: BrowserWindow) {
        super();
        this.window = window;
        this.#debugger = window.webContents.debugger;
        this.#debugger.on('message', (_, method, params) => {
            this.emit(method as keyof ProtocolMapping.Events, params);
            switch (method) {
                case 'Runtime.executionContextCreated': {
                    const event = params as Protocol.Runtime.ExecutionContextCreatedEvent;
                    this.emit('executionContextCreated', new ExecutionContext(this, event.context));
                    break;
                }
            }
        });
    }

    send<T extends keyof ProtocolMapping.Commands>(method: T, params?: ProtocolMapping.Commands[T]['paramsType'][0], options?: CommandOptions): Promise<ProtocolMapping.Commands[T]['returnType']> {
        if (!this.#debugger.isAttached()) {
            throw new Error('not attacehd');
        }
        return this.#debugger.sendCommand(method, params);
    }

    attach(protocolVersion?: string) {
        if (!this.#debugger.isAttached()) {
            this.#debugger.attach(protocolVersion);
        }
    }

    detach() {
        this.#debugger.detach();
    }
}