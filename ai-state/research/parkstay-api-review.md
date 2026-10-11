# ParkStay API research (live-probed 2 Oct 2026)

Sample full response captured locally from GET /api/campground_map/ (not committed; trimmed samples live in `tests/fixtures/`). DBCA backend source reviewed from dbca-wa/parkstay_bs_v2.

## Endpoints
| Method/path | Used by | Auth | Notes |
|---|---|---|---|
| GET /api/search_suggest | searchCampgrounds | none | 258 items: 169 campgrounds, 64 parks, 25 promo areas. properties{type,id,name,zoom_level} + coordinates [lng,lat]. Code returns parks/promo areas mixed in (bug). |
| GET /api/campground_availabilty_view/?format=json&arrival=YYYY/MM/DD&departure=…&gear_type=all&features=[]&featurescs=[] | checkAvailability (Watches) | none | ONE call covers every campground: campground_available{cgId:{sites[],total_available,total_bookable}} + available_cg[{id}]. No prices. |
| GET /api/campsites/{id}/ | site-name cache | none | |
| GET /api/campsite_availablity_view/{cgId}/?arrival=YYYY/MM/DD&departure&num_adult…&gear_type | Site Sniper | none, needs ParkStay Referer | 200 with YYYY/MM/DD, **HTTP 500 with YYYY-MM-DD**. Fields: name, long_description (HTML), map (PDF), release_date, booking_open_date, booking_time_open, release_time_friendly, maxAdults, classes{}, sites[{id,name,type,class,price,gearType{tent,campervan,caravan…},features,min_people,max_people,max_vehicles,short_description,availability}]. availability entry = tuple [bookable:boolean, label('$30.00'|'Booked'|'Unavailable'|'Closed'…), price, _, _, 'YYYY-MM-DD']. |
| POST /api/create_booking (form-urlencoded, CSRF-exempt) | createBookingHold | session + queue cookie | {status:'success', pk}; 30-min hold. Not probed. |
| GET queue.dbca.wa.gov.au/api/check-create-session/?session_key&queue_group=parkstayv2 | QueueService | none | verified live 2026-04-06 per code. |
| /auth/login, /account/, /accounts/logout/, /campsite_availability/{id}/, /bookings/… , /queue/status/ | login, validateSession, logout, getCampsiteAvailability, booking CRUD, checkQueue | — | **NOT in the real backend routes.** docs/parkstay-api/ENDPOINTS.md largely guesswork. Real: /api/profile, /api/booking/, /api/complete_booking/…, /api/booking_pricing/, /api/get_confirmation/{id}/. |
| Unused public: /api/campground_map/, /api/campground_map_filter/, /api/campgrounds/{id}/, /api/parks/, /api/regions/, /api/districts/, /api/features/, /api/promo_areas/, /api/campsite_classes/, /api/places/ | — | public | |

## Map data — GET /api/campground_map/
1.19MB GeoJSON FeatureCollection (pre-generated server-side; cache daily client-side).
- 169 campgrounds, all with geometry.coordinates [lng,lat] (112.9–128.3°E, 35.1–14.8°S).
- id, properties.name; campground_type: 0 bookable online (106), 1 not bookable online (32), 2 other/third-party accommodation (30), 4 booking by application (1)
- max_advance_booking (180), description (EMPTY for all), features[{id,name,description,image,type}] (Toilet, 2WD road access, Dogs permitted)
- images[{image}] relative /media/parkstay/campground_images/… → prefix https://parkstay.dbca.wa.gov.au ; every campground ≥1 image
- info_url → exploreparks.dbca.wa.gov.au/site/{slug} (157/169)
- price_hint null; park{id,name,entry_fee_required,district{name,region{name}}} (67 parks, 10 regions)
- campsites[] (2,775): {id,name,tent,campervan,caravan,max_people,max_vehicles,description,features}
- Descriptions + prices per campground via campsite_availablity_view (long_description, per-night rates).
- Booking deep link: https://parkstay.dbca.wa.gov.au/search-availability/campground/?site_id={id}&arrival=YYYY/MM/DD&departure=…&num_adult=… (only for campground_type 0; else info_url)

## Generic vs ParkStay-specific
Generic: location w/ coords, images, amenities, external URL; grouping park→district→region; unit (campsite) w/ capacity+equipment; per-night availability+price; party; max advance window; bulk availability; temporary hold w/ expiry + payment hand-off; booking ref, cancellation, login session.
ParkStay-specific: DBCA virtual queue (sitequeuesession, parkstayv2); campsite classes; campground_type booking modes; release regimes (daily 00:00 AWST rollover, Ningaloo first-Tuesday 10:00, cancellation); release_date/booking_time_open; gear_type + vehicles; concession guests; postcode; Referer requirement, YYYY/MM/DD dates, misspelt URLs; passwordless email login (Azure AD B2C) + Gmail OTP; BPOINT/ledger payment; park entry fees; one booking per night rule.

## Proposed interface (sketch)
ProviderCapabilities { publicCatalog, geo, bulkAvailability, unitAvailability, pricing:'none'|'per_night'|'quote', holds?:{ttlMinutes}, inAppPayment, manageBookings, auth:'none'|'magic_link'|'oauth'|'password', waitingRoom, releaseInfo, maxAdvanceDays? }
BookingMode 'online'|'offline'|'external'|'application'
LocationSummary { providerId,id,name,lat,lng, group?{id,name,region?}, bookingMode, imageUrls[], amenities[{id,name}], unitCount?, equipment?[], infoUrl?, priceHint? }
LocationDetail extends LocationSummary { descriptionHtml?, mapUrl?, units: Unit[] }
Unit { id,name,classId?,minPeople?,maxPeople,maxVehicles?,equipment:Record<string,boolean>,amenities[],description? }
StayQuery { arrival,departure (ISO), party{adults,children?,infants?,concessions?}, equipment?, bbox? }
NightStatus { date, bookable, status:'available'|'booked'|'closed'|'not_released'|'unknown', price?, label? }
LocationAvailability { locationId, release?{opensAt?,open}, units[{unitId,nights[],fullyAvailable,total?}] }
AccommodationProvider { id,name,capabilities, listLocations(), getLocation(id), searchAvailability?(q), getAvailability(locationId,q), getBookingUrl(locationId,q?), auth?{status,begin,complete,signOut}, access?{ensure,on('status')} (waiting room), hold?(), bookings?{list,get,cancel?} }

## Bugs found by live probing
- Site Sniper wrong date format: sitesniper.service.ts toYmd sends YYYY-MM-DD → HTTP 500 every poll. Must be YYYY/MM/DD.
- Site Sniper wrong parsing: parseAvailabilityDays expects {date,status:'open'}, live data is tuple [bookable,label,price,_,_,date] → days empty, allOpen always false.
- Watch prices always 0 → maxPrice filter meaningless.
- searchCampgrounds mixes parks + promo areas into campground lists.

## Risks
- Rate limits (docs claim 60/min signed in, 30 unsigned, burst 10; unverified). App constant 30/min.
- Every /api/ response sets sitequeuesession + 1h app_sessionid; queue gating when active — avoid catalogue fetches near Ningaloo release times.
- Browser UA + ParkStay Referer required.
- DBCA terms: one account/person, one booking/night, genuine intent, own name, no resale.
- Image/data reuse outside ParkStay may need DBCA permission.
