const {
    getSeatTypeEnum,
    getAvailabilityTypeEnum,
    getDeckEnum,
    getCompartmentEnum,
    getWayTypeEnum
} = require('./enums');
const axios = require('axios');
const puppeteer = require('puppeteer');
const FormData = require('form-data');

// Helper to format date from DDMMYYYY to YYYY-MM-DDT00:00:00
const formatDate = (dateStr) => {
    if (!dateStr || dateStr.length !== 8) return null;
    const day = dateStr.substring(0, 2);
    const month = dateStr.substring(2, 4);
    const year = dateStr.substring(4, 8);
    return `${year}-${month}-${day}T00:00:00`;
};

// Helper to map class to FlightCabinClass integer
const getClassCode = (classStr) => {
    const map = {
        'e': 2, // Economy
        'pe': 3, // PremiumEconomy
        'b': 4, // Business
        'pb': 5, // PremiumBusiness
        'f': 6  // First
    };
    return map[classStr?.toLowerCase()] || 1; // Default to 1 (All)
};

// Helper to transform TBO search response
const transformSearchResponse = (tboResponse) => {
    if (!tboResponse || !tboResponse.Response || !tboResponse.Response.Results) {
        return [];
    }

    const { TraceId, Results } = tboResponse.Response;
    const flightResults = Results[0] || [];

    const mappedResults = flightResults.map(res => {
        // Flatten segments: TBO segments can be array of arrays
        let allSegments = [];
        if (Array.isArray(res.Segments)) {
            res.Segments.forEach(segArr => {
                if (Array.isArray(segArr)) allSegments = allSegments.concat(segArr);
                else allSegments.push(segArr);
            });
        }

        // Split into Outbound (TripIndicator 1) and Inbound (TripIndicator 2)
        const outboundSegs = allSegments.filter(s => s.TripIndicator === 1 || !s.TripIndicator);
        const inboundSegs = allSegments.filter(s => s.TripIndicator === 2);

        const mapLeg = (segments) => {
            if (!segments || segments.length === 0) return null;

            const mappedSegments = segments.map(s => ({
                airlineCode: s.Airline?.AirlineCode,
                flightNumber: s.Airline?.FlightNumber,
                origin: s.Origin?.Airport?.AirportCode,
                originCity: s.Origin?.Airport?.CityName,
                destination: s.Destination?.Airport?.AirportCode,
                destinationCity: s.Destination?.Airport?.CityName,
                depTime: s.Origin?.DepTime,
                arrTime: s.Destination?.ArrTime,
                duration: s.Duration,
                baggage: s.Baggage, // Expecting string like "15 Kg"
                layoverTime: 0
            }));

            // Calculate layover times
            for (let i = 0; i < mappedSegments.length - 1; i++) {
                const arrival = new Date(mappedSegments[i].arrTime);
                const departure = new Date(mappedSegments[i + 1].depTime);
                const diffMins = Math.floor((departure - arrival) / (1000 * 60));
                mappedSegments[i].layoverTime = diffMins > 0 ? diffMins : 0;
            }

            // Calculate total duration for the leg
            const firstDep = new Date(mappedSegments[0].depTime);
            const lastArr = new Date(mappedSegments[mappedSegments.length - 1].arrTime);
            const totalDuration = Math.floor((lastArr - firstDep) / (1000 * 60));

            return {
                duration: totalDuration,
                stops: Math.max(0, mappedSegments.length - 1),
                airlineName: segments[0].Airline?.AirlineName,
                segments: mappedSegments
            };
        };

        const outbound = mapLeg(outboundSegs);
        const inbound = mapLeg(inboundSegs);

        const optimized = {
            searchId: TraceId,
            resultIndex: res.ResultIndex,
            source: res.Source,
            isRefundable: res.IsRefundable === true || res.IsRefundable === 'true',
            isLCC: res.IsLCC === true || res.IsLCC === 'true',
            price: {
                currency: res.Fare?.Currency,
                total: res.Fare?.PublishedFare,
                base: res.Fare?.BaseFare,
                tax: res.Fare?.Tax
            },
            flights: {
                outbound: outbound
            }
        };

        if (inbound) {
            optimized.flights.inbound = inbound;
        }

        return optimized;
    });

    // Group flights by flight numbers and times, and nest fares
    const groupedFlights = new Map();

    mappedResults.forEach(flight => {
        let flightKey = '';
        
        if (flight.flights.outbound && flight.flights.outbound.segments && flight.flights.outbound.segments.length > 0) {
            // Key: join all segment flightNumbers + first depTime only
            // arrTime is intentionally excluded — it can differ slightly between sources (timezone suffix)
            const segs = flight.flights.outbound.segments;
            const segKey = segs.map(s => `${s.airlineCode}${s.flightNumber}`).join('-');
            // Normalize depTime to date+HHMM only (strip seconds & timezone) to handle format variations
            const rawDep = segs[0].depTime || '';
            const normDep = rawDep.substring(0, 16); // "2026-05-04T15:50"
            flightKey += `${segKey}@${normDep}`;
        }
        
        if (flight.flights.inbound && flight.flights.inbound.segments && flight.flights.inbound.segments.length > 0) {
            const segs = flight.flights.inbound.segments;
            const segKey = segs.map(s => `${s.airlineCode}${s.flightNumber}`).join('-');
            const rawDep = segs[0].depTime || '';
            const normDep = rawDep.substring(0, 16);
            flightKey += `|${segKey}@${normDep}`;
        }

        const fareDetail = {
            resultIndex: flight.resultIndex,
            source: flight.source,
            isRefundable: flight.isRefundable,
            isLCC: flight.isLCC,
            price: flight.price,
            baggage: flight.flights.outbound?.segments[0]?.baggage || '15 KG'
        };

        if (groupedFlights.has(flightKey)) {
            const existingGroup = groupedFlights.get(flightKey);
            
            // Check for exact duplicate fare (same price + same rules/baggage)
            const isDuplicate = existingGroup.fares.some(f => 
                f.price.total === fareDetail.price.total && 
                f.isRefundable === fareDetail.isRefundable && 
                f.baggage === fareDetail.baggage
            );

            if (!isDuplicate) {
                existingGroup.fares.push(fareDetail);
            }
        } else {
            // Create a new grouped object
            const newGroup = {
                searchId: flight.searchId,
                flights: flight.flights,
                fares: [fareDetail]
            };
            groupedFlights.set(flightKey, newGroup);
        }
    });

    // Sort fares within each group by price
    const result = Array.from(groupedFlights.values());
    result.forEach(group => {
        group.fares.sort((a, b) => a.price.total - b.price.total);
    });

    return result;
};

// Helper function to process row seats
const processRowSeats = (rowSeats) => {
    if (!rowSeats || rowSeats.length === 0) return rowSeats;

    // Find the maximum number of seats in any row
    const maxSeatsInRow = Math.max(...rowSeats.map(row => row.Seats?.length || 0));

    // Get the reference row (row with max seats)
    const referenceRow = rowSeats.find(row => row.Seats?.length === maxSeatsInRow);

    if (!referenceRow) return rowSeats;

    // Process each row
    return rowSeats.map(row => {
        if (!row.Seats || row.Seats.length === 0) return row;

        // If this row has fewer seats than the max, insert "NoSeat" placeholders
        if (row.Seats.length < maxSeatsInRow) {
            const processedSeats = [];
            let currentSeatIndex = 0;

            for (let i = 0; i < referenceRow.Seats.length; i++) {
                const refSeat = referenceRow.Seats[i];
                const currentSeat = row.Seats[currentSeatIndex];

                // Check if seat positions match
                if (currentSeat && currentSeat.SeatNo === refSeat.SeatNo) {
                    processedSeats.push(enhanceSeatInfo(currentSeat));
                    currentSeatIndex++;
                } else {
                    // Insert placeholder
                    processedSeats.push({
                        Code: "NoSeat",
                        SeatType: getSeatTypeEnum(refSeat.SeatType),
                        SeatNo: refSeat.SeatNo,
                        AvailablityType: 0,
                        Price: 0
                    });
                }
            }

            return { Seats: processedSeats };
        }

        // Process seats normally
        return {
            Seats: row.Seats.map(seat => enhanceSeatInfo(seat))
        };
    });
};

// Helper function to enhance seat info with enums
const enhanceSeatInfo = (seat) => {
    return {
        ...seat,
        SeatTypeEnum: getSeatTypeEnum(seat.SeatType),
        AvailabilityTypeEnum: getAvailabilityTypeEnum(seat.AvailablityType),
        DeckEnum: getDeckEnum(seat.Deck),
        CompartmentEnum: getCompartmentEnum(seat.Compartment),
        SeatWayTypeEnum: getWayTypeEnum(seat.SeatWayType)
    };
};

// Helper function to process SSR response
const processSSRResponse = (response) => {
    if (!response || !response.SeatDynamic) {
        return response;
    }

    const processedResponse = {
        ...response,
        SeatDynamic: response.SeatDynamic.map(segment => ({
            SegmentSeat: segment.SegmentSeat?.map(segmentSeat => ({
                RowSeats: processRowSeats(segmentSeat.RowSeats)
            }))
        }))
    };

    return processedResponse;
};

// Helper function to convert seat letter to number
const seatLetterToNumber = (letter) => {
    const map = {
        'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 6,
        'G': 7, 'H': 8, 'I': 9, 'J': 10, 'K': 11, 'L': 12,
        'M': 13, 'N': 14
    };
    return map[letter?.toUpperCase()] || 0;
};

const sendTelegramNotification = async (bookingData) => {
    try {
        const token = process.env.TELEGRAM_BOT_TOKEN || "8656995629:AAEHExGEVOfXZIF0aLza0T86wbwOShPdxp8";
        
        // Ensure telegramBot dependency is required inline or globally
        const { getSubscribers } = require('../services/telegramBot');
        let chatIds = getSubscribers();
        
        // Fallback to env chat ID if no one has subscribed yet
        if (chatIds.length === 0 && process.env.TELEGRAM_CHAT_ID) {
            chatIds.push(process.env.TELEGRAM_CHAT_ID);
        }

        if (chatIds.length === 0) {
            console.warn('No Telegram subscribers found. Send /start to the bot to subscribe.');
            return;
        }

        const itinerary = bookingData?.Response?.Response?.FlightItinerary;
        if (!itinerary) return;

        const pnr = itinerary.PNR;
        const bookingId = itinerary.BookingId;
        
        let msg = `🎉 <b>Flight Booked Successfully!</b>\n\n`;
        msg += `<b>PNR:</b> ${pnr}\n`;
        msg += `<b>Booking ID:</b> ${bookingId}\n\n`;

        msg += `👤 <b>Passenger Details:</b>\n`;
        itinerary.Passenger?.forEach(p => {
            msg += `- ${p.Title} ${p.FirstName} ${p.LastName}\n`;
            if (p.Email) msg += `  Email: ${p.Email}\n`;
            if (p.ContactNo) msg += `  Phone: ${p.ContactNo}\n`;
        });
        
        msg += `\n✈️ <b>Flight Details:</b>\n`;
        itinerary.Segments?.forEach(seg => {
            msg += `- <b>${seg.Airline?.AirlineName} (${seg.Airline?.AirlineCode} ${seg.Airline?.FlightNumber})</b>\n`;
            msg += `  ${seg.Origin?.Airport?.AirportCode} ➔ ${seg.Destination?.Airport?.AirportCode}\n`;
            msg += `  Dep: ${new Date(seg.Origin?.DepTime).toLocaleString()}\n`;
            msg += `  Arr: ${new Date(seg.Destination?.ArrTime).toLocaleString()}\n`;
        });

        // Generate PDF
        const htmlTemplate = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f3f4f6; padding: 40px; color: #333; margin: 0; }
                .ticket { background: #fff; max-width: 800px; margin: 0 auto; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); overflow: hidden; }
                .header { background: #1e3a8a; color: #fff; padding: 30px; text-align: center; }
                .header h1 { margin: 0; font-size: 28px; letter-spacing: 2px; text-transform: uppercase; }
                .header p { margin: 10px 0 0; font-size: 16px; opacity: 0.9; }
                .content { padding: 30px; }
                .row { display: flex; justify-content: space-between; margin-bottom: 25px; border-bottom: 1px solid #eee; padding-bottom: 20px; }
                .row:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
                .col { flex: 1; }
                .title { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; }
                .value { font-size: 18px; font-weight: 600; color: #111827; }
                h2 { color: #1e3a8a; font-size: 20px; margin-top: 0; border-bottom: 2px solid #ebf8ff; padding-bottom: 10px; margin-bottom: 20px; }
                .segment { background: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 15px; border-left: 4px solid #3b82f6; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th, td { text-align: left; padding: 12px; border-bottom: 1px solid #e5e7eb; }
                th { color: #6b7280; font-weight: 600; font-size: 14px; }
                td { font-size: 15px; color: #374151; }
                .tag { background: #dcfce7; color: #166534; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
                .footer { background: #f1f5f9; padding: 20px; text-align: center; font-size: 14px; color: #64748b; border-top: 1px dashed #cbd5e1; }
            </style>
        </head>
        <body>
            <div class="ticket">
                <div class="header">
                    <h1>E-Ticket Confirmed</h1>
                    <p>Thank you for booking with us! Have a safe journey.</p>
                </div>
                <div class="content">
                    <div class="row">
                        <div class="col">
                            <div class="title">Booking ID</div>
                            <div class="value">${bookingId}</div>
                        </div>
                        <div class="col" style="text-align: right;">
                            <div class="title">PNR Number</div>
                            <div class="value" style="color: #2563eb; font-size: 24px;">${pnr}</div>
                        </div>
                    </div>
                    
                    <h2>✈️ Flight Itinerary</h2>
                    ${itinerary.Segments?.map(seg => `
                    <div class="segment">
                        <div class="row" style="border:none; padding:0; margin:0;">
                            <div class="col">
                                <div class="value">${seg.Airline?.AirlineName}</div>
                                <div class="title">${seg.Airline?.AirlineCode} - ${seg.Airline?.FlightNumber}</div>
                            </div>
                            <div class="col" style="text-align: right;">
                                <span class="tag">${seg.CabinClass === 2 ? 'Business' : (seg.CabinClass === 6 ? 'First' : 'Economy')}</span>
                            </div>
                        </div>
                        <div class="row" style="border:none; padding:15px 0 0; margin:0; align-items:center;">
                            <div class="col">
                                <div class="value">${new Date(seg.Origin?.DepTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                                <div class="title">${new Date(seg.Origin?.DepTime).toLocaleDateString()}</div>
                                <div style="font-weight: bold; margin-top:5px;">${seg.Origin?.Airport?.AirportCode}</div>
                                <div class="title">${seg.Origin?.Airport?.CityName || ''}</div>
                            </div>
                            <div class="col" style="text-align: center; color:#94a3b8;">
                                <div>───── ✈ ─────</div>
                                <div class="title">${seg.Duration} mins</div>
                            </div>
                            <div class="col" style="text-align: right;">
                                <div class="value">${new Date(seg.Destination?.ArrTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                                <div class="title">${new Date(seg.Destination?.ArrTime).toLocaleDateString()}</div>
                                <div style="font-weight: bold; margin-top:5px;">${seg.Destination?.Airport?.AirportCode}</div>
                                <div class="title">${seg.Destination?.Airport?.CityName || ''}</div>
                            </div>
                        </div>
                    </div>`).join('')}

                    <h2>👤 Passenger Details</h2>
                    <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Ticket No</th>
                                <th>Type</th>
                                <th style="text-align:center;">QR Code</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itinerary.Passenger?.map(p => {
                                const barcodeContent = p.BarcodeDetails?.Barcode?.[0]?.Content || `PNR:${pnr} Name:${p.FirstName} ${p.LastName}`;
                                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(barcodeContent)}`;
                                return `
                            <tr>
                                <td><b>${p.Title} ${p.FirstName} ${p.LastName}</b><br><span style="font-size:12px;color:#6b7280;">${p.Email || ''} ${p.ContactNo || ''}</span></td>
                                <td>${p.Ticket?.TicketNumber || 'Pending'}</td>
                                <td>${p.PaxType === 1 ? 'Adult' : p.PaxType === 2 ? 'Child' : 'Infant'}</td>
                                <td style="text-align:center;"><img src="${qrUrl}" width="60" height="60" alt="QR" style="border-radius:4px;" /></td>
                            </tr>`}).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="footer">
                    <p>This is a computer-generated document. No signature is required.</p>
                </div>
            </div>
        </body>
        </html>`;

        const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
        const page = await browser.newPage();
        await page.setContent(htmlTemplate, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
        await browser.close();

        // Loop through all subscribed Chat IDs and send the notification
        for (const chatId of chatIds) {
            try {
                // 1. Send the text message
                await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                    chat_id: chatId,
                    text: msg,
                    parse_mode: 'HTML'
                });

                // 2. Send PDF Document
                const form = new FormData();
                form.append('chat_id', chatId);
                form.append('document', Buffer.from(pdfBuffer), { filename: `Ticket-${pnr}.pdf`, contentType: 'application/pdf' });
                
                await axios.post(`https://api.telegram.org/bot${token}/sendDocument`, form, {
                    headers: form.getHeaders()
                });

                console.log(`Telegram notification and PDF Ticket sent successfully to ${chatId}`);
            } catch (err) {
                console.error(`Failed to send Telegram notification to ${chatId}:`, err.message);
            }
        }
    } catch (error) {
        console.error('Error sending Telegram PDF notification:', error.message);
    }
};

module.exports = {
    formatDate,
    getClassCode,
    transformSearchResponse,
    processRowSeats,
    enhanceSeatInfo,
    processSSRResponse,
    seatLetterToNumber,
    sendTelegramNotification
};
