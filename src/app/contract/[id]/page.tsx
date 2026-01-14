'use client';

import { useEffect, useRef, useState } from 'react';
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { Booking, BookingItem, Product } from '@/types';
import { useParams, useSearchParams } from 'next/navigation';
import {
  Anchor,
  CheckCircle,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  Languages,
  Loader2,
  PenTool,
  ShoppingBag,
} from 'lucide-react';
import { differenceInDays, format, eachDayOfInterval } from 'date-fns';
import { enUS, es } from 'date-fns/locale';

const CONTRACT_COPY = {
  es: {
    language: {
      label: 'Idioma',
      es: 'ES',
      en: 'EN',
    },
    header: {
      title: 'Contrato de Alquiler',
      reference: 'Referencia',
    },
    lessor: {
      title: 'Arrendador',
      entityLabel: 'Entidad',
      addressLabel: 'Dirección',
      entity: 'NIRVANA CHARTER S.L.U.',
      addressLines: ['C/Jose Riquer Llobet nº 14 2º piso A', 'Ibiza (Islas Baleares)'],
    },
    sections: {
      client: 'Datos del Cliente',
      delivery: 'Detalles de Entrega',
      rental: 'Resumen del Alquiler',
      payment: 'Pago',
      terms: 'Términos y Condiciones',
      signature: 'Firma Digital',
    },
    labels: {
      name: 'Nombre',
      email: 'Email',
      phone: 'Teléfono',
      location: 'Ubicación',
      deliveryTime: 'Hora de Entrega',
      boat: 'Barco',
      docking: 'Amarre',
      totalToPay: 'Total a Pagar',
      duration: 'Duración',
      daysSingular: 'día',
      daysPlural: 'días',
      startDate: 'Fecha inicio',
      endDate: 'Fecha fin',
      notes: 'Observaciones',
      notProvided: 'No especificado',
    },
    payment: {
      confirmed: 'Pago Confirmado',
      pending: 'Pago Pendiente',
      paidOn: 'Pagado el',
      payNow: 'Realizar Pago Ahora',
      redirectNote: 'Serás redirigido a Stripe para completar el pago de forma segura.',
      unavailableTitle: 'Enlace de pago no disponible',
      unavailableNote: 'Contacta con el agente para realizar el pago.',
      direct: 'Pago directo',
      requiredWarning: '⚠️ Debes completar el pago antes de poder firmar el contrato',
      requiredNote: 'Una vez realizado el pago, podrás aceptar los términos y firmar digitalmente.',
    },
    success: {
      title: '¡Contrato Firmado!',
      body: 'Gracias, {name}. Tu reserva ha sido confirmada correctamente.',
      nextSteps: 'Siguientes Pasos',
      step1: 'Recibirás un email con los detalles.',
      step2: 'El pago se realizará según lo acordado.',
      step3: 'Nos vemos en {location} el {date}.',
      download: 'Descargar Copia',
    },
    actions: {
      clear: 'Borrar',
      confirm: 'Confirmar y Firmar Contrato',
      loading: 'Cargando contrato...',
      invalid: 'Enlace inválido o expirado.',
      notFound: 'Reserva no encontrada.',
      loadError: 'Error al cargar la reserva.',
      signError: 'Error al guardar el contrato.',
    },
    signature: {
      hint: 'Firma aquí (dedo o ratón)',
      note: '* Al firmar, aceptas la responsabilidad sobre el equipo alquilado.',
    },
    terms: {
      acceptance: [
        `La firma del arrendador y del arrendatario en el presente documento supone la aceptación por ambas partes de los precios y condiciones particulares y generales establecidas en el mismo y en especial, el arrendador se obliga a entregar el propulsor acuático, objeto de alquiler en el lugar, fecha y hora especificados en perfecto estado de funcionamiento y el arrendatario a recibirla en el mismo momento, a cuidarla durante el tiempo que dure el alquiler y a devolverla en el lugar, fecha y hora acordados.`,
        `El arrendatario declara expresamente que ha leído, entendido y que acepta todas las condiciones generales de alquiler descritas al dorso así como que conoce la reglamentación marítimo general y local vigente.`,
        `Firma por duplicado en ___________día___de_________20_____.`,
      ],
      showMore: 'Ver condiciones generales completas',
      acceptLabel: 'He leído y acepto las condiciones particulares y generales del alquiler.',
      regulationsLabel: 'Declaro conocer la reglamentación marítimo general y local vigente.',
      generalTitle: 'Condiciones Generales',
      clauses: [
        {
          title: '1º',
          text: `El plazo de alquiler del objeto ofertado por el arrendador y que el arrendatario está interesado en alquilar tendrá la duración indicada en el anverso de este documento y el arrendatario tomará posesión de la fecha pactada, con la batería completamente cargada (según corresponda), previo pago del monto total del alquiler y la fianza de seguridad asociada. El consumo del cargo antes de la devolución del objeto no dará derecho al arrendatario al prorrateo del precio pagado por el alquiler del objeto. El suministro de información falsa por parte del arrendatario en cualquiera de las especificaciones particulares de este contrato dará lugar a la terminación inmediata del mismo, en cuyo caso las cantidades pagadas por adelantado se perderán a favor del arrendador. El arrendatario pagará al arrendador las siguientes cantidades si este último cancela el alquiler acordado del objeto por cualquier motivo: 5% por cancelación con más de tres meses de antelación antes de la fecha de inicio del alquiler acordado; 25% por cancelación con más de un mes y menos de tres meses de antelación; 50% con más de siete días y menos de un mes de anticipación y 100% con menos de siete días de anticipación. El arrendador devolverá las cantidades pagadas por adelantado que superen los porcentajes antes mencionados.`,
        },
        {
          title: '2º',
          text: `Finalizado el período de alquiler pactado, el objeto será devuelto al mismo lugar en que el arrendatario tomó posesión de este, antes del anochecer del último día del período de alquiler y en perfectas condiciones de navegabilidad y en todos los demás aspectos. En caso contrario, se cobrará al arrendatario la cantidad de quinientos euros (500,00 €) como indemnización, sin perjuicio del derecho del arrendador a reclamar los daños y perjuicios y lucro cesante por falta de disponibilidad del objeto alquilado. El arrendatario autoriza expresamente al arrendador a utilizar la tarjeta de crédito indicada en el anverso de este documento para liquidar dichos importes de buena fe.`,
        },
        {
          title: '3º',
          text: `La finalidad del alquiler es el uso recreativo por parte del arrendatario del objeto en las aguas indicadas por el arrendador en el apartado (zona de inclusión) del anverso de este contrato. El objeto no podrá ser utilizado fuera de dichas zonas de inclusión sin el permiso expreso del arrendador.`,
        },
        {
          title: '4º',
          text: `El arrendador se compromete a respetar las siguientes instrucciones de seguridad para la carga de la batería si el período de alquiler es superior a un día:`,
          subclauses: [
            '1ª Lave toda la superficie exterior de la batería con agua dulce.',
            '2ª Seque los conectores de la batería, las pantallas digitales y el powergrip (si lo hubiera).',
            '3ª Cargue la batería hasta que el indicador marque carga completa.',
            '4ª Vuelva a colocar las tapas de mantenimiento después de cargar la batería.',
            '5ª Nunca deje el powergrip o el pulsador en condiciones húmedas, bloqueadas o sucias. Apague siempre estos dispositivos después de su uso.',
          ],
        },
        {
          title: '5º',
          text: `El arrendatario deberá depositar la fianza indicada en el anverso de este documento con el arrendador como garantía por cualquier pérdida, daño, robo o demora en la devolución del objeto alquilado. No obstante, el monto de dicha fianza será devuelto al arrendatario en caso de que la embarcación se encuentre en condiciones satisfactorias a la devolución.`,
        },
        {
          title: '6º',
          text: `Con la firma del presente contrato el arrendatario declara que el arrendador ha facilitado un resumen de las instrucciones de uso del objeto alquilado, especificaciones técnicas y medidas de seguridad que puedan afectar al uso del mismo y que el arrendador también ha emitido las instrucciones de seguridad pertinentes, detalles y especificaciones requeridas para utilizar la embarcación de forma segura y preservar la integridad física de la misma, de las personas a bordo y de terceros.`,
        },
        {
          title: '7º',
          text: `Las siguientes son prácticas prohibidas y medidas a tomar en consideración para el uso seguro y eficiente del objeto. El incumplimiento de alguno de los mismos dará lugar a la ejecución de la fianza de garantía por indemnización punitiva y económica:`,
          subclauses: [
            '1ª El objeto alquilado no puede ser utilizado por personas menores de dieciséis (16) años sin la supervisión de un adulto. Las siguientes personas no pueden utilizar el objeto alquilado: mujeres embarazadas, personas con marcapasos cardíaco, personas con problemas de salud previos, personas que muestren signos de embriaguez, uso de drogas o uso de medicamentos que puedan reducir su capacidad física y reflejos.',
            '2ª La embarcación alquilada no podrá ser amarrada en canales de acceso a playas, dejarla junto a cualquier otra embarcación u objeto flotante ni dejarse amarrada en la costa o en zonas rocosas o bajíos. Tampoco podrá ser utilizado para labores de salvamento marítimo, navegación nocturna, participación en regatas, pesca de cualquier tipo o como ayuda a la pesca ni para realizar ningún tipo de actividad ilegal o sujeta a sanción.',
            '3ª Las personas a bordo de la embarcación deberán llevar siempre ropa adecuada, con chaleco salvavidas y gafas de buceo, sin lentes de contacto y con el cabello sujeto por un sombrero u otro dispositivo de sujeción del cabello o cortado por encima de los hombros.',
            '4ª La embarcación sólo debe utilizarse para navegar en aguas abrigadas, radas, ensenadas o bahías, nunca en mar abierto, en zonas de tránsito marítimo o cerca de muelles, diques o embarcaciones en navegación. Los usuarios no deben bucear solos.',
            '5ª No podrá ser utilizado en zonas ocupadas por bañistas o buceadores, en bajíos o zonas de bajíos y nunca en aguas de menos de un metro de profundidad. La inmersión del objeto alquilado a profundidades superiores a 2,5 metros solo se permitirá a los buzos profesionales que posean la calificación requerida para estos fines.',
            '6ª No debe utilizarse en zonas sujetas a corrientes marinas, con poca visibilidad, vientos fuertes, marejada o tormenta acompañada de rayos.',
            '7ª Se debe respetar en todo momento una distancia mínima de seguridad de la persona u objeto más cercano. El objeto nunca debe ser transportado por menos de dos personas, quienes realizarán el trabajo utilizando las asas de transporte laterales provistas al efecto y colocando siempre el objeto sobre una superficie estable, seca y lisa. El objeto alquilado nunca debe ser levantado por las empuñaduras de control, el guardabarros delantero o el panel de visualización con el que pueda estar provisto. Nunca lance el objeto alquilado al mar desde cualquier altura, desde otro barco, muelle o costa y nunca lo use fuera del agua.',
            '8ª El arrendador debe controlar el nivel de carga de la batería para asegurar la capacidad de regresar al punto de partida sin problemas.',
            '9ª El objeto alquilado no debe almacenarse ni mantenerse expuesto a la luz solar directa o dentro de un vehículo de motor.',
            '10ª Asegúrese de que la batería no se caliente por encima de los sesenta grados centígrados (60 ºC).',
            '11ª Abstenerse de abrir, golpear, perforar o quemar el compartimento de la batería y nunca tocar el canal de chorro mientras esté en funcionamiento.',
            '12ª No intente retirar objetos que puedan haber entrado en el canal de propulsión e inmediatamente avise al arrendador para que lo abra, elimine cualquier obstrucción y compruebe el estado del objeto alquilado.',
          ],
        },
        {
          title: '8º',
          text: `En caso de pérdida o desaparición del objeto alquilado imputable a negligencia, imprudencia o cualquier otra forma de mal uso del arrendatario, el arrendador tendrá derecho a reclamar una indemnización por importe igual al valor de mercado del artefacto en el momento del siniestro y retendrá la fianza de seguridad como pago a cuenta de la liquidación final.`,
        },
        {
          title: '9º',
          text: `El arrendador podrá rescindir unilateralmente el contrato si durante el período de alquiler se observa que el usuario está realizando maniobras que pongan en riesgo la integridad de las personas y los bienes. En este caso, el arrendatario perderá todas las cantidades abonadas que constituyan el precio del alquiler.`,
        },
        {
          title: '10º',
          text: `El objeto alquilado no podrá subarrendar sin el consentimiento previo expreso del arrendador.`,
        },
        {
          title: '11º',
          text: `El usuario del inmueble alquilado será el principal responsable, el arrendatario subsidiariamente y el arrendador quedará indemne en caso de persecución por incumplimiento de las normas y reglamentos marítimos y / o aduaneros. En caso de accidente y si la empresa con la que el arrendador ha contratado el seguro a todo riesgo, responsabilidad civil y ocupantes incumple, por cualquier motivo, en cubrir la totalidad o parte de los daños y perjuicios resultantes, gastos o gastos civiles.`,
        },
        {
          title: '12º',
          text: `Las partes, con renuncia expresa a cualquier otro fuero al que pudieran tener derecho, acuerdan expresamente someter las discrepancias, litigios o controversias derivadas de la interpretación o ejecución de este contrato a los juzgados de Ibiza. Las partes designan los domicilios antes señalados como sus domicilios a los efectos de la notificación prevista en el artículo 1.435 de la ley de procedimiento civil o cualquier otra legislación que sea de aplicación ahora o en el futuro, dejando indemne al arrendador al respecto.`,
        },
      ],
    },
  },
  en: {
    language: {
      label: 'Language',
      es: 'ES',
      en: 'EN',
    },
    header: {
      title: 'Rental Agreement',
      reference: 'Reference',
    },
    lessor: {
      title: 'Lessor',
      entityLabel: 'Entity',
      addressLabel: 'Address',
      entity: 'NIRVANA CHARTER S.L.U.',
      addressLines: ['C/Jose Riquer Llobet nº 14 2º piso A', 'Ibiza (Balearic Islands)'],
    },
    sections: {
      client: 'Client Details',
      delivery: 'Delivery Details',
      rental: 'Rental Summary',
      payment: 'Payment',
      terms: 'Terms and Conditions',
      signature: 'Digital Signature',
    },
    labels: {
      name: 'Name',
      email: 'Email',
      phone: 'Phone',
      location: 'Location',
      deliveryTime: 'Delivery Time',
      boat: 'Boat',
      docking: 'Berth',
      totalToPay: 'Total Due',
      duration: 'Duration',
      daysSingular: 'day',
      daysPlural: 'days',
      startDate: 'Start date',
      endDate: 'End date',
      notes: 'Notes',
      notProvided: 'Not provided',
    },
    payment: {
      confirmed: 'Payment Confirmed',
      pending: 'Payment Pending',
      paidOn: 'Paid on',
      payNow: 'Pay Now',
      redirectNote: 'You will be redirected to Stripe to complete the payment securely.',
      unavailableTitle: 'Payment link not available',
      unavailableNote: 'Please contact the agent to complete payment.',
      direct: 'Direct payment',
      requiredWarning: '⚠️ You must complete payment before you can sign the contract',
      requiredNote: 'Once payment is complete, you will be able to accept terms and sign digitally.',
    },
    success: {
      title: 'Contract Signed!',
      body: 'Thank you, {name}. Your booking has been successfully confirmed.',
      nextSteps: 'Next Steps',
      step1: 'You will receive an email with the details.',
      step2: 'Payment will be made as agreed.',
      step3: 'See you at {location} on {date}.',
      download: 'Download Copy',
    },
    actions: {
      clear: 'Clear',
      confirm: 'Confirm and Sign Contract',
      loading: 'Loading contract...',
      invalid: 'Invalid or expired link.',
      notFound: 'Booking not found.',
      loadError: 'Error loading booking.',
      signError: 'Error saving contract.',
    },
    signature: {
      hint: 'Sign here (finger or mouse)',
      note: '* By signing, you accept responsibility for the rented equipment.',
    },
    terms: {
      acceptance: [
        `The signature of the lessor and the lessee in this document implies acceptance by both parties of the prices and the specific and general conditions established herein. In particular, the lessor undertakes to deliver the water propulsion device, the object of the rental, at the specified place, date, and time in perfect working order, and the lessee to receive it at the same time, take care of it during the rental period, and return it at the agreed place, date, and time.`,
        `The lessee expressly declares that they have read, understood, and accept all the general rental conditions described on the reverse side and that they are aware of the general and local maritime regulations in force.`,
        `Signed in duplicate in ___________ on ___ day of __________ 20_____.`,
      ],
      showMore: 'View full general conditions',
      acceptLabel: 'I have read and accept the specific and general rental conditions.',
      regulationsLabel: 'I declare that I am aware of the applicable general and local maritime regulations.',
      generalTitle: 'General Conditions',
      clauses: [
        {
          title: '1',
          text: `The rental period of the item offered by the lessor and requested by the lessee shall be the duration indicated on the front of this document and the lessee shall take possession on the agreed date, with the battery fully charged (as applicable), after payment of the total rental amount and the associated security deposit. Use of the charge before return of the item does not entitle the lessee to any prorated refund of the rental price. Providing false information in any of the specific details of this contract will result in immediate termination, and any amounts paid in advance will be retained by the lessor. The lessee will pay the lessor the following amounts if the lessee cancels the agreed rental for any reason: 5% for cancellation more than three months before the agreed start date; 25% for cancellation more than one month and less than three months before; 50% for cancellation more than seven days and less than one month before; and 100% for cancellation with less than seven days' notice. The lessor will refund any amounts paid in advance exceeding the percentages mentioned above.`,
        },
        {
          title: '2',
          text: `At the end of the agreed rental period, the item shall be returned to the same place where the lessee took possession, before sunset on the last day of the rental period, and in perfect navigable condition and in all other aspects. Otherwise, the lessee will be charged five hundred euros (€500.00) as compensation, without prejudice to the lessor's right to claim damages and lost profits due to lack of availability of the rented item. The lessee expressly authorizes the lessor to use the credit card indicated on the front of this document to settle such amounts in good faith.`,
        },
        {
          title: '3',
          text: `The purpose of the rental is recreational use by the lessee of the item in the waters indicated by the lessor in the (inclusion zone) section on the front of this contract. The item may not be used outside those inclusion zones without the express permission of the lessor.`,
        },
        {
          title: '4',
          text: `The lessor undertakes to follow the following safety instructions for charging the battery if the rental period is longer than one day:`,
          subclauses: [
            '1. Wash the entire exterior surface of the battery with fresh water.',
            '2. Dry the battery connectors, digital displays, and the powergrip (if any).',
            '3. Charge the battery until the indicator shows full charge.',
            '4. Replace the maintenance covers after charging the battery.',
            '5. Never leave the powergrip or the trigger wet, locked, or dirty. Always switch these devices off after use.',
          ],
        },
        {
          title: '5',
          text: `The lessee must deposit the security deposit indicated on the front of this document with the lessor as a guarantee for any loss, damage, theft, or delay in returning the rented item. However, the amount of the deposit will be returned to the lessee if the craft is in satisfactory condition upon return.`,
        },
        {
          title: '6',
          text: `By signing this contract, the lessee declares that the lessor has provided a summary of the operating instructions, technical specifications, and safety measures that may affect the use of the rented item, and that the lessor has also issued the relevant safety instructions, details, and specifications required to use the craft safely and preserve the physical integrity of the craft, the persons on board, and third parties.`,
        },
        {
          title: '7',
          text: `The following are prohibited practices and measures to be considered for the safe and efficient use of the item. Failure to comply with any of them will result in execution of the security deposit as punitive and financial compensation:`,
          subclauses: [
            '1. The rented item may not be used by persons under sixteen (16) years of age without adult supervision. The following persons may not use the rented item: pregnant women, persons with cardiac pacemakers, persons with pre-existing health problems, persons showing signs of intoxication, drug use or use of medicines that may reduce their physical capacity and reflexes.',
            '2. The rented craft may not be moored in access channels to beaches, left alongside any other vessel or floating object, nor left moored on the shore or in rocky or shallow areas. Nor may it be used for maritime rescue operations, night navigation, participation in regattas, fishing of any kind or as an aid to fishing, nor for any illegal activity or activity subject to sanctions.',
            '3. Persons on board the craft must always wear appropriate clothing, with a life jacket and diving goggles, without contact lenses, and with hair secured by a hat or other hair restraint device or cut above the shoulders.',
            '4. The craft must only be used for navigation in sheltered waters, roadsteads, coves, or bays, never in open sea, in maritime traffic zones, or near piers, breakwaters, or vessels underway. Users must not dive alone.',
            '5. It may not be used in areas occupied by swimmers or divers, in shallows or shallow areas, and never in waters less than one meter deep. Immersion of the rented item to depths greater than 2.5 meters is only permitted to professional divers with the required qualification for these purposes.',
            '6. It must not be used in areas subject to marine currents, with low visibility, strong winds, swell, or thunderstorms accompanied by lightning.',
            '7. A minimum safe distance from the nearest person or object must be maintained at all times. The item must never be transported by fewer than two people, who must carry it using the lateral transport handles provided and always place the item on a stable, dry, and smooth surface. The rented item must never be lifted by the control handles, front fender, or display panel with which it may be equipped. Never throw the rented item into the sea from any height, from another boat, pier, or shore, and never use it out of the water.',
            '8. The lessor must monitor the battery charge level to ensure the ability to return to the starting point without problems.',
            '9. The rented item must not be stored or kept exposed to direct sunlight or inside a motor vehicle.',
            '10. Ensure that the battery does not heat above sixty degrees Celsius (60 ºC).',
            '11. Refrain from opening, striking, drilling, or burning the battery compartment and never touch the jet channel while it is running.',
            '12. Do not attempt to remove objects that may have entered the propulsion channel and immediately notify the lessor to open it, remove any obstruction, and check the condition of the rented item.',
          ],
        },
        {
          title: '8',
          text: `In case of loss or disappearance of the rented item attributable to negligence, imprudence, or any other form of misuse by the lessee, the lessor shall be entitled to claim compensation equal to the market value of the device at the time of the loss and will retain the security deposit as partial payment of the final settlement.`,
        },
        {
          title: '9',
          text: `The lessor may unilaterally terminate the contract if during the rental period it is observed that the user is carrying out maneuvers that put at risk the integrity of persons and property. In this case, the lessee will forfeit all amounts paid that constitute the rental price.`,
        },
        {
          title: '10',
          text: `The rented item may not be subleased without the prior express consent of the lessor.`,
        },
        {
          title: '11',
          text: `The user of the rented property will be primarily responsible, the lessee secondarily, and the lessor shall be held harmless in case of prosecution for non-compliance with maritime and/or customs regulations. In case of accident and if the company with which the lessor has contracted all-risk insurance, civil liability and occupants fails, for any reason, to cover all or part of the resulting damages and losses, expenses or civil costs.`,
        },
        {
          title: '12',
          text: `The parties, expressly waiving any other jurisdiction to which they may be entitled, expressly agree to submit any disagreements, litigation, or disputes arising from the interpretation or execution of this contract to the courts of Ibiza. The parties designate the aforementioned addresses as their domiciles for the purposes of notification provided for in Article 1.435 of the Civil Procedure Law or any other legislation that is applicable now or in the future, holding the lessor harmless in this respect.`,
        },
      ],
    },
  },
} as const;

type Language = 'es' | 'en';

const LOCATION_LABELS = {
  marina_ibiza: { es: 'Marina Ibiza', en: 'Marina Ibiza' },
  marina_botafoch: { es: 'Marina Botafoch', en: 'Marina Botafoch' },
  club_nautico: { es: 'Club Náutico', en: 'Club Náutico' },
  otro: { es: 'Otro', en: 'Other' },
} as const;

export default function ContractPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params?.id as string;
  const token = searchParams.get('t');
  const paymentStatus = searchParams.get('payment');
  const languageParam = searchParams.get('lang');

  const [lang, setLang] = useState<Language>('es');
  const copy = CONTRACT_COPY[lang];
  const locale = lang === 'es' ? es : enUS;
  const numberLocale = lang === 'es' ? 'es-ES' : 'en-US';

  const [booking, setBooking] = useState<Booking | null>(null);
  const [productMap, setProductMap] = useState<Record<string, Product>>({});
  const [loading, setLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<'invalid' | 'notFound' | 'loadError' | null>(null);

  const [termsAccepted, setTermsAccepted] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    if (languageParam === 'en' || languageParam === 'es') {
      setLang(languageParam);
    }
  }, [languageParam]);

  useEffect(() => {
    const fetchBooking = async () => {
      try {
        if (!id) return;
        const docRef = doc(db, 'bookings', id);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = { id: docSnap.id, ...docSnap.data() } as Booking;

          if (data.token_acceso && data.token_acceso !== token) {
            setErrorKey('invalid');
            setLoading(false);
            return;
          }

          setBooking(data);
          if (data.acuerdo_firmado) {
            setSuccess(true);
          }

          if (paymentStatus === 'success') {
            setTimeout(() => {
              fetchBooking();
            }, 2000);
          }
        } else {
          setErrorKey('notFound');
        }
      } catch (err) {
        console.error(err);
        setErrorKey('loadError');
      } finally {
        setLoading(false);
      }
    };

    fetchBooking();
  }, [id, token, paymentStatus]);

  useEffect(() => {
    const fetchProducts = async () => {
      if (!booking?.items?.length) return;
      const ids = Array.from(new Set(booking.items.map((item) => item.producto_id).filter(Boolean)));
      if (!ids.length) return;

      const map: Record<string, Product> = {};
      try {
        for (let i = 0; i < ids.length; i += 10) {
          const chunk = ids.slice(i, i + 10);
          const q = query(collection(db, 'products'), where(documentId(), 'in', chunk));
          const snapshot = await getDocs(q);
          snapshot.docs.forEach((docSnap) => {
            map[docSnap.id] = { id: docSnap.id, ...docSnap.data() } as Product;
          });
        }
        setProductMap(map);
      } catch (err) {
        console.error('Error fetching products:', err);
      }
    };

    fetchProducts();
  }, [booking]);

  const getDate = (timestamp: any): Date => {
    if (!timestamp) return new Date();
    if (timestamp && typeof timestamp.toDate === 'function') {
      return timestamp.toDate();
    }
    if (timestamp instanceof Date) {
      return timestamp;
    }
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      return new Date();
    }
    return date;
  };

  const adjustStockReservation = async (bookingToUpdate: Booking, delta: number) => {
    if (!bookingToUpdate?.items?.length) return;
    const start = new Date(bookingToUpdate.fecha_inicio);
    const end = new Date(bookingToUpdate.fecha_fin);
    const days = eachDayOfInterval({ start, end });
    const batch = writeBatch(db);

    days.forEach((day) => {
      const dateStr = format(day, 'yyyy-MM-dd');
      bookingToUpdate.items.forEach((item) => {
        const stockRef = doc(db, 'daily_stock', `${dateStr}_${item.producto_id}`);
        batch.set(
          stockRef,
          {
            fecha: dateStr,
            producto_id: item.producto_id,
            cantidad_reservada: increment(delta * item.cantidad),
            actualizado_por: 'system_expiration',
            timestamp: serverTimestamp(),
          },
          { merge: true }
        );
      });
    });

    await batch.commit();
  };

  useEffect(() => {
    const expireIfNeeded = async () => {
      if (!booking) return;
      if (booking.pago_realizado || booking.acuerdo_firmado) return;
      if (booking.expirado || booking.estado === 'expirada') return;
      if (!booking.expiracion) return;

      const now = new Date();
      const expirationDate = getDate(booking.expiracion);

      if (now > expirationDate) {
        try {
          await updateDoc(doc(db, 'bookings', booking.id), {
            estado: 'expirada',
            expirado: true,
            updated_at: serverTimestamp(),
          });
          await adjustStockReservation(booking, -1);
          setBooking((prev) =>
            prev ? { ...prev, estado: 'expirada', expirado: true } : prev
          );
        } catch (err) {
          console.error('Error expiring booking:', err);
        }
      }
    };

    expireIfNeeded();
  }, [booking]);

  const getProductName = (item: BookingItem) => {
    if (item.producto_nombre) return item.producto_nombre;
    if (productMap[item.producto_id]) return productMap[item.producto_id].nombre;
    return item.producto_id || copy.labels.notProvided;
  };

  const getLocationLabel = (value?: Booking['ubicacion_entrega']) => {
    if (!value) return copy.labels.notProvided;
    return LOCATION_LABELS[value]?.[lang] || value;
  };

  const getErrorMessage = () => {
    if (!errorKey) return '';
    switch (errorKey) {
      case 'invalid':
        return copy.actions.invalid;
      case 'notFound':
        return copy.actions.notFound;
      case 'loadError':
        return copy.actions.loadError;
      default:
        return copy.actions.loadError;
    }
  };

  const getDateFormat = () => (lang === 'es' ? 'dd/MM/yyyy' : 'MMM dd, yyyy');

  const getPaymentDateFormat = () => (lang === 'es' ? 'dd MMM yyyy' : 'MMM dd, yyyy');

  const rentalDays = booking
    ? Math.max(1, differenceInDays(new Date(booking.fecha_fin), new Date(booking.fecha_inicio)))
    : 1;

  const getCoordinates = (e: any, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX, clientY;
    if (e.touches && e.touches[0]) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      offsetX: (clientX - rect.left) * scaleX,
      offsetY: (clientY - rect.top) * scaleY,
    };
  };

  const startDrawing = (e: any) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000';

    setIsDrawing(true);
    const { offsetX, offsetY } = getCoordinates(e, canvas);
    ctx.beginPath();
    ctx.moveTo(offsetX, offsetY);
  };

  const draw = (e: any) => {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { offsetX, offsetY } = getCoordinates(e, canvas);
    ctx.lineTo(offsetX, offsetY);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    if (canvasRef.current) {
      setSignature(canvasRef.current.toDataURL());
    }
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      setSignature(null);
    }
  };

  const handleSubmit = async () => {
    if (!booking || !signature || !termsAccepted) return;
    
    // Critical: Cannot confirm without payment
    if (!booking.pago_realizado) {
      alert(lang === 'es' 
        ? '⚠️ Debes completar el pago antes de firmar el contrato.' 
        : '⚠️ You must complete payment before signing the contract.');
      return;
    }

    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'bookings', booking.id), {
        acuerdo_firmado: true,
        firma_cliente: signature,
        terminos_aceptados: true,
        terminos_aceptados_en: serverTimestamp(),
        estado: 'confirmada',
      });
      setSuccess(true);
    } catch (err) {
      console.error(err);
      alert(copy.actions.signError);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="animate-spin text-blue-600" size={40} />
          <p className="text-sm text-slate-500">{copy.actions.loading}</p>
        </div>
      </div>
    );
  }

  if (errorKey) {
    return (
      <div className="min-h-screen flex items-center justify-center text-red-600 font-bold px-4 text-center">
        {getErrorMessage()}
      </div>
    );
  }

  if (!booking) return null;

  if (success) {
    const successMessage = copy.success.body.replace('{name}', booking.cliente.nombre);
    const successDate = format(new Date(booking.fecha_inicio), getDateFormat(), { locale });
    const successLocation = getLocationLabel(booking.ubicacion_entrega);
    const successStep3 = copy.success.step3
      .replace('{location}', successLocation)
      .replace('{date}', successDate);

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full">
          <div className="bg-green-100 p-4 rounded-full inline-flex mb-4">
            <CheckCircle size={48} className="text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{copy.success.title}</h1>
          <p className="text-gray-600 mb-6">{successMessage}</p>

          <div className="bg-blue-50 p-4 rounded-xl text-left mb-6">
            <h3 className="font-bold text-blue-900 text-sm uppercase mb-2">{copy.success.nextSteps}</h3>
            <ul className="text-sm text-blue-800 space-y-2 list-disc pl-4">
              <li>{copy.success.step1}</li>
              <li>{copy.success.step2}</li>
              <li>{successStep3}</li>
            </ul>
          </div>

          <button
            onClick={() => window.print()}
            className="btn-primary w-full py-3"
          >
            <Download size={20} /> {copy.success.download}
          </button>
        </div>
      </div>
    );
  }

  const formattedStartDate = format(new Date(booking.fecha_inicio), getDateFormat(), { locale });
  const formattedEndDate = format(new Date(booking.fecha_fin), getDateFormat(), { locale });

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 md:px-8">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="bg-slate-900 text-white p-6 md:p-8">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold mb-2">{copy.header.title}</h1>
              <p className="text-slate-400">
                {copy.header.reference}: {booking.numero_reserva}
              </p>
            </div>
            <div className="flex flex-col items-end gap-4">
              <div className="h-12 w-12 bg-white rounded-lg flex items-center justify-center text-slate-900 font-bold">
                SB
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 text-xs text-slate-300">
                  <Languages size={16} />
                  <span>{copy.language.label}</span>
                </div>
                <div className="flex items-center gap-1 bg-slate-800 rounded-full p-1">
                  <button
                    onClick={() => setLang('es')}
                    className={`px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
                      lang === 'es' ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {copy.language.es}
                  </button>
                  <button
                    onClick={() => setLang('en')}
                    className={`px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
                      lang === 'en' ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {copy.language.en}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 md:p-8 space-y-8">
          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2">{copy.lessor.title}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm bg-slate-50 p-4 rounded-xl">
              <div>
                <span className="block text-gray-500">{copy.lessor.entityLabel}</span>
                <span className="font-semibold text-gray-900">{copy.lessor.entity}</span>
              </div>
              <div>
                <span className="block text-gray-500">{copy.lessor.addressLabel}</span>
                <span className="font-semibold text-gray-900">{copy.lessor.addressLines[0]}</span>
                <span className="block text-gray-700">{copy.lessor.addressLines[1]}</span>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2">{copy.sections.client}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="block text-gray-500">{copy.labels.name}</span>
                <span className="font-semibold text-gray-900">{booking.cliente.nombre}</span>
              </div>
              <div>
                <span className="block text-gray-500">{copy.labels.email}</span>
                <span className="font-semibold text-gray-900">{booking.cliente.email}</span>
              </div>
              <div>
                <span className="block text-gray-500">{copy.labels.phone}</span>
                <span className="font-semibold text-gray-900">
                  {booking.cliente.telefono || copy.labels.notProvided}
                </span>
              </div>
              <div>
                <span className="block text-gray-500">{copy.labels.startDate}</span>
                <span className="font-semibold text-gray-900">{formattedStartDate}</span>
              </div>
              <div>
                <span className="block text-gray-500">{copy.labels.endDate}</span>
                <span className="font-semibold text-gray-900">{formattedEndDate}</span>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2 flex items-center gap-2">
              <Anchor size={20} className="text-blue-600" />
              {copy.sections.delivery}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm bg-blue-50 p-4 rounded-xl">
              <div>
                <span className="block text-blue-600 font-bold text-xs uppercase mb-1">
                  {copy.labels.location}
                </span>
                <span className="font-bold text-gray-900 text-lg">
                  {getLocationLabel(booking.ubicacion_entrega)}
                </span>
              </div>
              {booking.hora_entrega && (
                <div>
                  <span className="block text-blue-600 font-bold text-xs uppercase mb-1">
                    {copy.labels.deliveryTime}
                  </span>
                  <span className="font-bold text-gray-900 text-lg">{booking.hora_entrega}</span>
                </div>
              )}
              {booking.nombre_barco && (
                <div>
                  <span className="block text-blue-600 font-bold text-xs uppercase mb-1">
                    {copy.labels.boat}
                  </span>
                  <span className="font-semibold text-gray-900">{booking.nombre_barco}</span>
                </div>
              )}
              {booking.numero_amarre && (
                <div>
                  <span className="block text-blue-600 font-bold text-xs uppercase mb-1">
                    {copy.labels.docking}
                  </span>
                  <span className="font-semibold text-gray-900">{booking.numero_amarre}</span>
                </div>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2 flex items-center gap-2">
              <ShoppingBag size={20} className="text-blue-600" />
              {copy.sections.rental}
            </h2>
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              <div className="text-xs text-gray-500">
                {copy.labels.duration}: {rentalDays}{' '}
                {rentalDays === 1 ? copy.labels.daysSingular : copy.labels.daysPlural}
              </div>
              {booking.items.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center text-sm">
                  <span className="font-medium text-gray-900">
                    {item.cantidad}x {getProductName(item)}
                  </span>
                </div>
              ))}
              <div className="border-t border-gray-200 pt-3 mt-3 flex justify-between items-center">
                <span className="font-bold text-gray-900">{copy.labels.totalToPay}</span>
                <span className="font-bold text-xl text-gray-900">
                  €{booking.precio_total.toLocaleString(numberLocale, { minimumFractionDigits: 2 })}
                </span>
              </div>
              {booking.notas && (
                <div className="text-sm text-gray-600">
                  <span className="font-semibold text-gray-800">{copy.labels.notes}:</span> {booking.notas}
                </div>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2 flex items-center gap-2">
              <CreditCard size={20} className="text-blue-600" />
              {copy.sections.payment}
            </h2>
            {booking.estado === 'expirada' ? (
              <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4 text-center">
                <div className="text-red-700 font-medium">
                  {lang === 'es'
                    ? '⏰ Esta reserva ha expirado por falta de pago'
                    : '⏰ This reservation has expired due to non-payment'}
                </div>
                <div className="text-sm text-red-600 mt-1">
                  {lang === 'es'
                    ? 'El producto vuelve a estar disponible. Contacta con el agente para crear una nueva reserva.'
                    : 'The product is available again. Please contact the agent to create a new booking.'}
                </div>
              </div>
            ) : booking.pago_realizado ? (
              <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 flex items-center gap-3">
                <div className="bg-green-100 p-2 rounded-lg">
                  <CheckCircle size={24} className="text-green-600" />
                </div>
                <div>
                  <div className="font-bold text-green-700">{copy.payment.confirmed}</div>
                  <div className="text-sm text-green-600">
                    {booking.pago_realizado_en &&
                      `${copy.payment.paidOn} ${format(getDate(booking.pago_realizado_en), getPaymentDateFormat(), {
                        locale,
                      })}`}
                  </div>
                </div>
              </div>
            ) : booking.stripe_payment_link ? (
              <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="font-bold text-blue-900 mb-1">{copy.payment.pending}</div>
                    <div className="text-sm text-blue-700">
                      {copy.labels.totalToPay}: €
                      {booking.precio_total.toLocaleString(numberLocale, { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="bg-blue-100 p-2 rounded-lg">
                    <CreditCard size={24} className="text-blue-600" />
                  </div>
                </div>
                <a
                  href={booking.stripe_payment_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary w-full py-3"
                >
                  <ExternalLink size={20} />
                  {copy.payment.payNow}
                </a>
                <p className="text-xs text-blue-600 mt-2 text-center">{copy.payment.redirectNote}</p>
              </div>
            ) : (
              <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4 text-center">
                <div className="text-yellow-700 font-medium">{copy.payment.unavailableTitle}</div>
                <div className="text-sm text-yellow-600 mt-1">{copy.payment.unavailableNote}</div>
              </div>
            )}
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2 flex items-center gap-2">
              <FileText size={20} className="text-blue-600" />
              {copy.sections.terms}
            </h2>
            
            {/* Payment Required Warning */}
            {!booking.pago_realizado && (
              <div className="bg-orange-50 border-2 border-orange-300 rounded-xl p-4 mb-4">
                <div className="flex items-start gap-3">
                  <div className="text-orange-600 mt-0.5">
                    <CreditCard size={24} />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-orange-900 mb-1">{copy.payment.requiredWarning}</p>
                    <p className="text-sm text-orange-700">{copy.payment.requiredNote}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3 text-xs text-gray-600">
              {copy.terms.acceptance
                .filter((p) => !p.includes('___')) // Remove any lines with blank underscores
                .map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              <p>
                {lang === 'es'
                  ? `Firma por duplicado en Ibiza a ${format(new Date(), "d 'de' MMMM 'de' yyyy", { locale })}.`
                  : `Signed in duplicate in Ibiza on ${format(new Date(), 'MMMM d, yyyy', { locale })}.`}
              </p>
            </div>
            <details className="mt-4 bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs text-gray-600">
              <summary className="cursor-pointer font-semibold text-gray-700">
                {copy.terms.showMore}
              </summary>
              <div className="mt-3 space-y-3">
                <h3 className="text-sm font-bold text-gray-800">{copy.terms.generalTitle}</h3>
                {copy.terms.clauses.map((clause) => (
                  <div key={clause.title} className="space-y-2">
                    <p>
                      <strong>{clause.title}</strong> {clause.text}
                    </p>
                    {'subclauses' in clause && clause.subclauses && (
                      <ul className="list-disc pl-5 space-y-1">
                        {clause.subclauses.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </details>
            <div className="mt-4 flex items-center gap-3">
              <input
                type="checkbox"
                id="terms"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                disabled={!booking.pago_realizado}
                className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500 border-gray-300 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <label htmlFor="terms" className={`text-sm text-gray-700 font-medium select-none ${booking.pago_realizado ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                {copy.terms.acceptLabel}
              </label>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2 flex items-center gap-2">
              <PenTool size={20} className="text-blue-600" />
              {copy.sections.signature}
            </h2>
            <div className={`border-2 border-dashed rounded-xl relative overflow-hidden ${
              booking.pago_realizado 
                ? 'border-gray-300 bg-gray-50 touch-none' 
                : 'border-gray-200 bg-gray-100 opacity-60 cursor-not-allowed'
            }`}>
              <canvas
                ref={canvasRef}
                width={600}
                height={200}
                className={`w-full h-48 ${booking.pago_realizado ? 'cursor-crosshair touch-none' : 'pointer-events-none'}`}
                onMouseDown={booking.pago_realizado ? startDrawing : undefined}
                onMouseMove={booking.pago_realizado ? draw : undefined}
                onMouseUp={booking.pago_realizado ? stopDrawing : undefined}
                onMouseLeave={booking.pago_realizado ? stopDrawing : undefined}
                onTouchStart={booking.pago_realizado ? startDrawing : undefined}
                onTouchMove={booking.pago_realizado ? draw : undefined}
                onTouchEnd={booking.pago_realizado ? stopDrawing : undefined}
              />
              {!signature && !isDrawing && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <p className="text-gray-400 text-sm">
                    {booking.pago_realizado 
                      ? copy.signature.hint 
                      : (lang === 'es' ? '🔒 Completa el pago primero' : '🔒 Complete payment first')}
                  </p>
                </div>
              )}
              <button
                onClick={clearSignature}
                disabled={!booking.pago_realizado}
                className="absolute top-2 right-2 btn-outline text-rose-600 border-rose-200 px-2 py-1 text-xs hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {copy.actions.clear}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">{copy.signature.note}</p>
          </section>

          <div className="pt-6 border-t border-gray-100">
            {!booking.pago_realizado && (
              <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4 mb-4 text-center">
                <p className="font-bold text-red-900">
                  {lang === 'es' 
                    ? '🔒 El contrato no se puede confirmar sin completar el pago' 
                    : '🔒 Contract cannot be confirmed without completing payment'}
                </p>
                <p className="text-sm text-red-700 mt-1">
                  {lang === 'es'
                    ? 'Por favor, realiza el pago en la sección "Pago" arriba para continuar.'
                    : 'Please complete payment in the "Payment" section above to continue.'}
                </p>
              </div>
            )}
            <button
              onClick={handleSubmit}
              disabled={!termsAccepted || !signature || submitting || !booking.pago_realizado}
              className="btn-primary w-full py-4 text-lg disabled:opacity-50"
            >
              {submitting ? <Loader2 className="animate-spin" size={24} /> : <CheckCircle size={24} />}
              {copy.actions.confirm}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
