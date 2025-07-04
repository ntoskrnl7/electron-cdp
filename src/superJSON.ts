import SuperJSON from 'superjson';
import { Buffer as NodeBuffer } from 'buffer';
import { Buffer } from 'buffer/';

function makeSerializableObject(obj: object | null, current: number, depth: number) {
    const ret: { [key: string]: object | null } = {};
    for (const key in Object.getPrototypeOf(obj)) {
        const value = (obj as { [key: string]: object })[key];
        switch (typeof value) {
            case 'function':
                break;
            case 'object':
                if (value) {
                    ret[key] = makeSerializableI(value, current + 1, depth);
                }
                break;
            default:
                ret[key] = value;
                break;
        }
    }
    for (const key in obj) {
        const value = (obj as { [key: string]: object })[key];
        switch (typeof value) {
            case 'function':
                break;
            case 'object':
                if (value) {
                    ret[key] = makeSerializableI(value, current + 1, depth);
                }
                break;
            default:
                ret[key] = value;
                break;
        }
    }
    return ret;
}

function makeSerializableI(obj: object | null, current: number, depth: number) {
    if (obj === null) {
        return null;
    }
    if (obj instanceof Error) {
        if (obj.stack === undefined) {
            return JSON.parse(JSON.stringify({
                name: obj.name,
                message: obj.message
            }));
        } else {
            return JSON.parse(JSON.stringify({
                name: obj.name,
                message: obj.message,
                stack: obj.stack
            }));
        }
    } else if (obj instanceof Buffer) {
        return JSON.parse(JSON.stringify(obj));
    }
    if (current > depth) {
        try {
            return JSON.parse(JSON.stringify(obj));
        } catch {
            return null;
        }
    }

    return makeSerializableObject(obj, current, depth);
}

export function makeSerializable(obj: object | null, depth?: number): object | null {
    return makeSerializableI(obj, 1, depth ?? 1);
}

export function registerTypes(superJSON: typeof SuperJSON | SuperJSON) {

    function isEventObject(obj: object): obj is Event {
        if (obj && typeof obj === 'object') {
            let currentProto = Object.getPrototypeOf(obj);
            while (currentProto) {
                if (currentProto.constructor.name === 'Event') {
                    return true;
                }
                currentProto = Object.getPrototypeOf(currentProto);
            }
        }
        return false;
    }

    superJSON.registerCustom<Event, string>(
        {
            isApplicable: (v) => isEventObject(v),
            serialize: (v) => superJSON.stringify(makeSerializable(v)),
            deserialize: (v) => superJSON.parse(v),
        },
        'Event'
    );

    superJSON.registerCustom<NodeBuffer, number[]>(
        {
            isApplicable: (v): v is NodeBuffer => NodeBuffer.isBuffer(v),
            serialize: (v) => [...v],
            deserialize: (v) => NodeBuffer.from(v),
        },
        'NodeBuffer'
    );

    superJSON.registerCustom<Buffer, number[]>(
        {
            isApplicable: (v): v is Buffer => Buffer.isBuffer(v),
            serialize: (v) => [...v],
            deserialize: (v) => Buffer.from(v),
        },
        'Buffer'
    );

    superJSON.registerCustom<Uint8Array, number[]>(
        {
            isApplicable: (v): v is Uint8Array => v instanceof Uint8Array,
            serialize: (v) => [...v],
            deserialize: (v) => Uint8Array.from(v),
        },
        'Uint8Array'
    );
}

registerTypes(SuperJSON);

export default SuperJSON;