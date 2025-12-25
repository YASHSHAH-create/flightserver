const getSeatTypeEnum = (type) => {
    const seatTypes = {
        0: 'NotSet', 1: 'Window', 2: 'Aisle', 3: 'Middle',
        4: 'WindowRecline', 5: 'WindowWing', 6: 'WindowExitRow',
        7: 'WindowReclineWing', 8: 'WindowReclineExitRow', 9: 'WindowWingExitRow',
        10: 'AisleRecline', 11: 'AisleWing', 12: 'AisleExitRow',
        13: 'AisleReclineWing', 14: 'AisleReclineExitRow', 15: 'AisleWingExitRow',
        16: 'MiddleRecline', 17: 'MiddleWing', 18: 'MiddleExitRow',
        19: 'MiddleReclineWing', 20: 'MiddleReclineExitRow', 21: 'MiddleWingExitRow',
        22: 'WindowReclineWingExitRow', 23: 'AisleReclineWingExitRow', 24: 'MiddleReclineWingExitRow',
        25: 'WindowBulkhead', 26: 'WindowQuiet', 27: 'WindowBulkheadQuiet',
        28: 'MiddleBulkhead', 29: 'MiddleQuiet', 30: 'MiddleBulkheadQuiet',
        31: 'AisleBulkhead', 32: 'AisleQuiet', 33: 'AisleBulkheadQuiet'
    };
    return seatTypes[type] || 'NotSet';
};

const getAvailabilityTypeEnum = (type) => {
    const types = {
        0: 'NotSet', 1: 'Open', 2: 'CheckedIn', 3: 'Reserved', 4: 'FleetBlocked'
    };
    return types[type] || 'NotSet';
};

const getDeckEnum = (deck) => {
    const decks = { 0: 'NotSet', 1: 'Deck1', 2: 'Deck2', 3: 'Deck3' };
    return decks[deck] || 'NotSet';
};

const getCompartmentEnum = (compartment) => {
    const compartments = {
        0: 'NotSet', 1: 'Compartment1', 2: 'Compartment2', 3: 'Compartment3',
        4: 'Compartment4', 5: 'Compartment5', 6: 'Compartment6', 7: 'Compartment7'
    };
    return compartments[compartment] || 'NotSet';
};

const getWayTypeEnum = (type) => {
    const types = { 0: 'NotSet', 1: 'Segment', 2: 'FullJourney' };
    return types[type] || 'NotSet';
};

module.exports = {
    getSeatTypeEnum,
    getAvailabilityTypeEnum,
    getDeckEnum,
    getCompartmentEnum,
    getWayTypeEnum
};
