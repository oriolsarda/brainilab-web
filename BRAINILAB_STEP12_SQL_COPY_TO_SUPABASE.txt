-- BrainiLab Backend — Step 12: Gameplay polish + Topic Rush
-- Run after Steps 1–11.
--
-- Replaces Map Hunt in the CURRENT Daily product with Topic Rush:
-- one server-selected topic, 60 seconds, type as many valid answers as possible.
-- Map Hunt tables/results are retained only for historical compatibility.
--
-- No service-role browser key. Public gameplay uses controlled RPCs.

begin;

create extension if not exists pgcrypto;
create extension if not exists unaccent;

-- ============================================================
-- TOPIC RUSH SETTINGS / CONTENT
-- ============================================================

create table if not exists public.topic_rush_settings(
  singleton boolean primary key default true,
  launch_date date not null default current_date,
  cooldown_days integer not null default 14,
  duration_seconds integer not null default 60,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint topic_rush_singleton check(singleton=true),
  constraint topic_rush_cooldown_range check(cooldown_days between 0 and 60),
  constraint topic_rush_duration_range check(duration_seconds between 30 and 180)
);

insert into public.topic_rush_settings(
  singleton,launch_date,cooldown_days,duration_seconds
)
values(true,current_date,14,60)
on conflict(singleton) do nothing;


create table if not exists public.topic_rush_topics(
  id uuid primary key default gen_random_uuid(),
  external_key text not null unique,
  title text not null,
  prompt text not null,
  target_count integer not null default 15,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint topic_rush_external_key_length
    check(char_length(external_key) between 3 and 120),

  constraint topic_rush_title_length
    check(char_length(title) between 3 and 120),

  constraint topic_rush_prompt_length
    check(char_length(prompt) between 3 and 300),

  constraint topic_rush_target_range
    check(target_count between 5 and 30)
);


create table if not exists public.topic_rush_answers(
  id uuid primary key default gen_random_uuid(),

  topic_id uuid not null
    references public.topic_rush_topics(id) on delete cascade,

  answer_text text not null,
  normalized_answer text not null,
  normalized_aliases text[] not null default '{}'::text[],

  created_at timestamptz not null default now(),

  unique(topic_id,normalized_answer),

  constraint topic_rush_answer_length
    check(char_length(answer_text) between 1 and 160)
);


create table if not exists public.daily_topic_rush(
  daily_challenge_id uuid primary key
    references public.daily_challenges(id) on delete cascade,

  topic_id uuid not null
    references public.topic_rush_topics(id) on delete restrict,

  created_at timestamptz not null default now()
);

create index if not exists topic_rush_answers_topic_idx
  on public.topic_rush_answers(topic_id);

create index if not exists daily_topic_rush_topic_idx
  on public.daily_topic_rush(topic_id);


create or replace function public.brainilab_normalize_topic_rush_answer(
  p_value text
)
returns text
language sql
stable
set search_path=public,extensions
as $$
  select regexp_replace(
    lower(unaccent(btrim(coalesce(p_value,'')))),
    '[^a-z0-9]+',
    '',
    'g'
  );
$$;

revoke execute on function public.brainilab_normalize_topic_rush_answer(text)
  from public,anon,authenticated;


-- Migration-only seed helper.
create or replace function public._seed_brainilab_topic_rush(
  p_external_key text,
  p_title text,
  p_prompt text,
  p_target_count integer,
  p_answers jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_topic_id uuid;
  v_item jsonb;
  v_answer text;
  v_aliases text[];
begin
  insert into public.topic_rush_topics(
    external_key,title,prompt,target_count,is_active
  )
  values(
    p_external_key,p_title,p_prompt,p_target_count,true
  )
  on conflict(external_key)
  do update set
    title=excluded.title,
    prompt=excluded.prompt,
    target_count=excluded.target_count,
    is_active=true,
    updated_at=now()
  returning id into v_topic_id;

  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_answers,'[]'::jsonb))
  loop
    v_answer:=btrim(coalesce(v_item->>'answer',''));

    select coalesce(
      array_agg(
        public.brainilab_normalize_topic_rush_answer(x.value#>>'{}')
      ) filter(
        where public.brainilab_normalize_topic_rush_answer(x.value#>>'{}')<>''
      ),
      '{}'::text[]
    )
    into v_aliases
    from jsonb_array_elements(coalesce(v_item->'aliases','[]'::jsonb)) x;

    if v_answer<>'' then
      insert into public.topic_rush_answers(
        topic_id,
        answer_text,
        normalized_answer,
        normalized_aliases
      )
      values(
        v_topic_id,
        v_answer,
        public.brainilab_normalize_topic_rush_answer(v_answer),
        v_aliases
      )
      on conflict(topic_id,normalized_answer)
      do update set
        answer_text=excluded.answer_text,
        normalized_aliases=excluded.normalized_aliases;
    end if;
  end loop;

  return v_topic_id;
end;
$$;

-- Seed 15 launch topics.
select public._seed_brainilab_topic_rush('african-countries','Countries in Africa','Name countries in Africa.',15,'[{"answer":"Algeria","aliases":[]},{"answer":"Angola","aliases":[]},{"answer":"Benin","aliases":[]},{"answer":"Botswana","aliases":[]},{"answer":"Burkina Faso","aliases":[]},{"answer":"Burundi","aliases":[]},{"answer":"Cabo Verde","aliases":["Cape Verde"]},{"answer":"Cameroon","aliases":[]},{"answer":"Central African Republic","aliases":[]},{"answer":"Chad","aliases":[]},{"answer":"Comoros","aliases":[]},{"answer":"Democratic Republic of the Congo","aliases":["DR Congo","DRC","Congo Kinshasa","Congo-Kinshasa"]},{"answer":"Republic of the Congo","aliases":["Congo Republic","Congo Brazzaville","Congo-Brazzaville"]},{"answer":"Côte d''Ivoire","aliases":["Cote d''Ivoire","Ivory Coast"]},{"answer":"Djibouti","aliases":[]},{"answer":"Egypt","aliases":[]},{"answer":"Equatorial Guinea","aliases":[]},{"answer":"Eritrea","aliases":[]},{"answer":"Eswatini","aliases":["Swaziland"]},{"answer":"Ethiopia","aliases":[]},{"answer":"Gabon","aliases":[]},{"answer":"Gambia","aliases":["The Gambia"]},{"answer":"Ghana","aliases":[]},{"answer":"Guinea","aliases":[]},{"answer":"Guinea-Bissau","aliases":[]},{"answer":"Kenya","aliases":[]},{"answer":"Lesotho","aliases":[]},{"answer":"Liberia","aliases":[]},{"answer":"Libya","aliases":[]},{"answer":"Madagascar","aliases":[]},{"answer":"Malawi","aliases":[]},{"answer":"Mali","aliases":[]},{"answer":"Mauritania","aliases":[]},{"answer":"Mauritius","aliases":[]},{"answer":"Morocco","aliases":[]},{"answer":"Mozambique","aliases":[]},{"answer":"Namibia","aliases":[]},{"answer":"Niger","aliases":[]},{"answer":"Nigeria","aliases":[]},{"answer":"Rwanda","aliases":[]},{"answer":"São Tomé and Príncipe","aliases":["Sao Tome and Principe"]},{"answer":"Senegal","aliases":[]},{"answer":"Seychelles","aliases":[]},{"answer":"Sierra Leone","aliases":[]},{"answer":"Somalia","aliases":[]},{"answer":"South Africa","aliases":[]},{"answer":"South Sudan","aliases":[]},{"answer":"Sudan","aliases":[]},{"answer":"Tanzania","aliases":[]},{"answer":"Togo","aliases":[]},{"answer":"Tunisia","aliases":[]},{"answer":"Uganda","aliases":[]},{"answer":"Zambia","aliases":[]},{"answer":"Zimbabwe","aliases":[]}]'::jsonb);
select public._seed_brainilab_topic_rush('countries-americas','Countries in the Americas','Name sovereign countries in North, Central or South America and the Caribbean.',15,'[{"answer":"Antigua and Barbuda","aliases":[]},{"answer":"Argentina","aliases":[]},{"answer":"Bahamas","aliases":["The Bahamas"]},{"answer":"Barbados","aliases":[]},{"answer":"Belize","aliases":[]},{"answer":"Bolivia","aliases":[]},{"answer":"Brazil","aliases":[]},{"answer":"Canada","aliases":[]},{"answer":"Chile","aliases":[]},{"answer":"Colombia","aliases":[]},{"answer":"Costa Rica","aliases":[]},{"answer":"Cuba","aliases":[]},{"answer":"Dominica","aliases":[]},{"answer":"Dominican Republic","aliases":[]},{"answer":"Ecuador","aliases":[]},{"answer":"El Salvador","aliases":[]},{"answer":"Grenada","aliases":[]},{"answer":"Guatemala","aliases":[]},{"answer":"Guyana","aliases":[]},{"answer":"Haiti","aliases":[]},{"answer":"Honduras","aliases":[]},{"answer":"Jamaica","aliases":[]},{"answer":"Mexico","aliases":[]},{"answer":"Nicaragua","aliases":[]},{"answer":"Panama","aliases":[]},{"answer":"Paraguay","aliases":[]},{"answer":"Peru","aliases":[]},{"answer":"Saint Kitts and Nevis","aliases":[]},{"answer":"Saint Lucia","aliases":[]},{"answer":"Saint Vincent and the Grenadines","aliases":[]},{"answer":"Suriname","aliases":[]},{"answer":"Trinidad and Tobago","aliases":[]},{"answer":"United States","aliases":["USA","US","United States of America"]},{"answer":"Uruguay","aliases":[]},{"answer":"Venezuela","aliases":[]}]'::jsonb);
select public._seed_brainilab_topic_rush('eu-members','European Union countries','Name current European Union member countries.',15,'[{"answer":"Austria","aliases":[]},{"answer":"Belgium","aliases":[]},{"answer":"Bulgaria","aliases":[]},{"answer":"Croatia","aliases":[]},{"answer":"Cyprus","aliases":[]},{"answer":"Czechia","aliases":["Czech Republic"]},{"answer":"Denmark","aliases":[]},{"answer":"Estonia","aliases":[]},{"answer":"Finland","aliases":[]},{"answer":"France","aliases":[]},{"answer":"Germany","aliases":[]},{"answer":"Greece","aliases":[]},{"answer":"Hungary","aliases":[]},{"answer":"Ireland","aliases":[]},{"answer":"Italy","aliases":[]},{"answer":"Latvia","aliases":[]},{"answer":"Lithuania","aliases":[]},{"answer":"Luxembourg","aliases":[]},{"answer":"Malta","aliases":[]},{"answer":"Netherlands","aliases":[]},{"answer":"Poland","aliases":[]},{"answer":"Portugal","aliases":[]},{"answer":"Romania","aliases":[]},{"answer":"Slovakia","aliases":[]},{"answer":"Slovenia","aliases":[]},{"answer":"Spain","aliases":[]},{"answer":"Sweden","aliases":[]}]'::jsonb);
select public._seed_brainilab_topic_rush('spanish-official','Countries where Spanish is an official language','Name sovereign countries where Spanish is an official language.',12,'[{"answer":"Argentina","aliases":[]},{"answer":"Bolivia","aliases":[]},{"answer":"Chile","aliases":[]},{"answer":"Colombia","aliases":[]},{"answer":"Costa Rica","aliases":[]},{"answer":"Cuba","aliases":[]},{"answer":"Dominican Republic","aliases":[]},{"answer":"Ecuador","aliases":[]},{"answer":"El Salvador","aliases":[]},{"answer":"Equatorial Guinea","aliases":[]},{"answer":"Guatemala","aliases":[]},{"answer":"Honduras","aliases":[]},{"answer":"Mexico","aliases":[]},{"answer":"Nicaragua","aliases":[]},{"answer":"Panama","aliases":[]},{"answer":"Paraguay","aliases":[]},{"answer":"Peru","aliases":[]},{"answer":"Spain","aliases":[]},{"answer":"Uruguay","aliases":[]},{"answer":"Venezuela","aliases":[]}]'::jsonb);
select public._seed_brainilab_topic_rush('us-states','U.S. states','Name U.S. states.',15,'[{"answer":"Alabama","aliases":[]},{"answer":"Alaska","aliases":[]},{"answer":"Arizona","aliases":[]},{"answer":"Arkansas","aliases":[]},{"answer":"California","aliases":[]},{"answer":"Colorado","aliases":[]},{"answer":"Connecticut","aliases":[]},{"answer":"Delaware","aliases":[]},{"answer":"Florida","aliases":[]},{"answer":"Georgia","aliases":[]},{"answer":"Hawaii","aliases":[]},{"answer":"Idaho","aliases":[]},{"answer":"Illinois","aliases":[]},{"answer":"Indiana","aliases":[]},{"answer":"Iowa","aliases":[]},{"answer":"Kansas","aliases":[]},{"answer":"Kentucky","aliases":[]},{"answer":"Louisiana","aliases":[]},{"answer":"Maine","aliases":[]},{"answer":"Maryland","aliases":[]},{"answer":"Massachusetts","aliases":[]},{"answer":"Michigan","aliases":[]},{"answer":"Minnesota","aliases":[]},{"answer":"Mississippi","aliases":[]},{"answer":"Missouri","aliases":[]},{"answer":"Montana","aliases":[]},{"answer":"Nebraska","aliases":[]},{"answer":"Nevada","aliases":[]},{"answer":"New Hampshire","aliases":[]},{"answer":"New Jersey","aliases":[]},{"answer":"New Mexico","aliases":[]},{"answer":"New York","aliases":[]},{"answer":"North Carolina","aliases":[]},{"answer":"North Dakota","aliases":[]},{"answer":"Ohio","aliases":[]},{"answer":"Oklahoma","aliases":[]},{"answer":"Oregon","aliases":[]},{"answer":"Pennsylvania","aliases":[]},{"answer":"Rhode Island","aliases":[]},{"answer":"South Carolina","aliases":[]},{"answer":"South Dakota","aliases":[]},{"answer":"Tennessee","aliases":[]},{"answer":"Texas","aliases":[]},{"answer":"Utah","aliases":[]},{"answer":"Vermont","aliases":[]},{"answer":"Virginia","aliases":[]},{"answer":"Washington","aliases":[]},{"answer":"West Virginia","aliases":[]},{"answer":"Wisconsin","aliases":[]},{"answer":"Wyoming","aliases":[]}]'::jsonb);
select public._seed_brainilab_topic_rush('us-state-capitals','U.S. state capitals','Name capital cities of U.S. states.',15,'[{"answer":"Montgomery","aliases":[]},{"answer":"Juneau","aliases":[]},{"answer":"Phoenix","aliases":[]},{"answer":"Little Rock","aliases":[]},{"answer":"Sacramento","aliases":[]},{"answer":"Denver","aliases":[]},{"answer":"Hartford","aliases":[]},{"answer":"Dover","aliases":[]},{"answer":"Tallahassee","aliases":[]},{"answer":"Atlanta","aliases":[]},{"answer":"Honolulu","aliases":[]},{"answer":"Boise","aliases":[]},{"answer":"Springfield","aliases":[]},{"answer":"Indianapolis","aliases":[]},{"answer":"Des Moines","aliases":[]},{"answer":"Topeka","aliases":[]},{"answer":"Frankfort","aliases":[]},{"answer":"Baton Rouge","aliases":[]},{"answer":"Augusta","aliases":[]},{"answer":"Annapolis","aliases":[]},{"answer":"Boston","aliases":[]},{"answer":"Lansing","aliases":[]},{"answer":"Saint Paul","aliases":[]},{"answer":"Jackson","aliases":[]},{"answer":"Jefferson City","aliases":[]},{"answer":"Helena","aliases":[]},{"answer":"Lincoln","aliases":[]},{"answer":"Carson City","aliases":[]},{"answer":"Concord","aliases":[]},{"answer":"Trenton","aliases":[]},{"answer":"Santa Fe","aliases":[]},{"answer":"Albany","aliases":[]},{"answer":"Raleigh","aliases":[]},{"answer":"Bismarck","aliases":[]},{"answer":"Columbus","aliases":[]},{"answer":"Oklahoma City","aliases":[]},{"answer":"Salem","aliases":[]},{"answer":"Harrisburg","aliases":[]},{"answer":"Providence","aliases":[]},{"answer":"Columbia","aliases":[]},{"answer":"Pierre","aliases":[]},{"answer":"Nashville","aliases":[]},{"answer":"Austin","aliases":[]},{"answer":"Salt Lake City","aliases":[]},{"answer":"Montpelier","aliases":[]},{"answer":"Richmond","aliases":[]},{"answer":"Olympia","aliases":[]},{"answer":"Charleston","aliases":[]},{"answer":"Madison","aliases":[]},{"answer":"Cheyenne","aliases":[]}]'::jsonb);
select public._seed_brainilab_topic_rush('african-capitals','African capital cities','Name national capital cities in Africa.',15,'[{"answer":"Algiers","aliases":[]},{"answer":"Luanda","aliases":[]},{"answer":"Porto-Novo","aliases":[]},{"answer":"Gaborone","aliases":[]},{"answer":"Ouagadougou","aliases":[]},{"answer":"Gitega","aliases":[]},{"answer":"Praia","aliases":[]},{"answer":"Yaoundé","aliases":[]},{"answer":"Bangui","aliases":[]},{"answer":"N''Djamena","aliases":[]},{"answer":"Moroni","aliases":[]},{"answer":"Kinshasa","aliases":[]},{"answer":"Brazzaville","aliases":[]},{"answer":"Yamoussoukro","aliases":[]},{"answer":"Djibouti","aliases":[]},{"answer":"Cairo","aliases":[]},{"answer":"Malabo","aliases":[]},{"answer":"Asmara","aliases":[]},{"answer":"Mbabane","aliases":[]},{"answer":"Lobamba","aliases":[]},{"answer":"Addis Ababa","aliases":[]},{"answer":"Libreville","aliases":[]},{"answer":"Banjul","aliases":[]},{"answer":"Accra","aliases":[]},{"answer":"Conakry","aliases":[]},{"answer":"Bissau","aliases":[]},{"answer":"Nairobi","aliases":[]},{"answer":"Maseru","aliases":[]},{"answer":"Monrovia","aliases":[]},{"answer":"Tripoli","aliases":[]},{"answer":"Antananarivo","aliases":[]},{"answer":"Lilongwe","aliases":[]},{"answer":"Bamako","aliases":[]},{"answer":"Nouakchott","aliases":[]},{"answer":"Port Louis","aliases":[]},{"answer":"Rabat","aliases":[]},{"answer":"Maputo","aliases":[]},{"answer":"Windhoek","aliases":[]},{"answer":"Niamey","aliases":[]},{"answer":"Abuja","aliases":[]},{"answer":"Kigali","aliases":[]},{"answer":"São Tomé","aliases":[]},{"answer":"Dakar","aliases":[]},{"answer":"Victoria","aliases":[]},{"answer":"Freetown","aliases":[]},{"answer":"Mogadishu","aliases":[]},{"answer":"Pretoria","aliases":[]},{"answer":"Cape Town","aliases":[]},{"answer":"Bloemfontein","aliases":[]},{"answer":"Juba","aliases":[]},{"answer":"Khartoum","aliases":[]},{"answer":"Dodoma","aliases":[]},{"answer":"Lomé","aliases":[]},{"answer":"Tunis","aliases":[]},{"answer":"Kampala","aliases":[]},{"answer":"Lusaka","aliases":[]},{"answer":"Harare","aliases":[]}]'::jsonb);
select public._seed_brainilab_topic_rush('eu-capitals','European Union capital cities','Name capital cities of current European Union member countries.',15,'[{"answer":"Vienna","aliases":[]},{"answer":"Brussels","aliases":[]},{"answer":"Sofia","aliases":[]},{"answer":"Zagreb","aliases":[]},{"answer":"Nicosia","aliases":[]},{"answer":"Prague","aliases":[]},{"answer":"Copenhagen","aliases":[]},{"answer":"Tallinn","aliases":[]},{"answer":"Helsinki","aliases":[]},{"answer":"Paris","aliases":[]},{"answer":"Berlin","aliases":[]},{"answer":"Athens","aliases":[]},{"answer":"Budapest","aliases":[]},{"answer":"Dublin","aliases":[]},{"answer":"Rome","aliases":[]},{"answer":"Riga","aliases":[]},{"answer":"Vilnius","aliases":[]},{"answer":"Luxembourg","aliases":[]},{"answer":"Valletta","aliases":[]},{"answer":"Amsterdam","aliases":[]},{"answer":"Warsaw","aliases":[]},{"answer":"Lisbon","aliases":[]},{"answer":"Bucharest","aliases":[]},{"answer":"Bratislava","aliases":[]},{"answer":"Ljubljana","aliases":[]},{"answer":"Madrid","aliases":[]},{"answer":"Stockholm","aliases":[]}]'::jsonb);
select public._seed_brainilab_topic_rush('chemical-elements','Chemical elements','Name chemical elements from the periodic table.',15,'[{"answer":"Hydrogen","aliases":[]},{"answer":"Helium","aliases":[]},{"answer":"Lithium","aliases":[]},{"answer":"Beryllium","aliases":[]},{"answer":"Boron","aliases":[]},{"answer":"Carbon","aliases":[]},{"answer":"Nitrogen","aliases":[]},{"answer":"Oxygen","aliases":[]},{"answer":"Fluorine","aliases":[]},{"answer":"Neon","aliases":[]},{"answer":"Sodium","aliases":[]},{"answer":"Magnesium","aliases":[]},{"answer":"Aluminium","aliases":["Aluminum"]},{"answer":"Silicon","aliases":[]},{"answer":"Phosphorus","aliases":[]},{"answer":"Sulfur","aliases":["Sulphur"]},{"answer":"Chlorine","aliases":[]},{"answer":"Argon","aliases":[]},{"answer":"Potassium","aliases":[]},{"answer":"Calcium","aliases":[]},{"answer":"Scandium","aliases":[]},{"answer":"Titanium","aliases":[]},{"answer":"Vanadium","aliases":[]},{"answer":"Chromium","aliases":[]},{"answer":"Manganese","aliases":[]},{"answer":"Iron","aliases":[]},{"answer":"Cobalt","aliases":[]},{"answer":"Nickel","aliases":[]},{"answer":"Copper","aliases":[]},{"answer":"Zinc","aliases":[]},{"answer":"Gallium","aliases":[]},{"answer":"Germanium","aliases":[]},{"answer":"Arsenic","aliases":[]},{"answer":"Selenium","aliases":[]},{"answer":"Bromine","aliases":[]},{"answer":"Krypton","aliases":[]},{"answer":"Rubidium","aliases":[]},{"answer":"Strontium","aliases":[]},{"answer":"Yttrium","aliases":[]},{"answer":"Zirconium","aliases":[]},{"answer":"Niobium","aliases":[]},{"answer":"Molybdenum","aliases":[]},{"answer":"Technetium","aliases":[]},{"answer":"Ruthenium","aliases":[]},{"answer":"Rhodium","aliases":[]},{"answer":"Palladium","aliases":[]},{"answer":"Silver","aliases":[]},{"answer":"Cadmium","aliases":[]},{"answer":"Indium","aliases":[]},{"answer":"Tin","aliases":[]},{"answer":"Antimony","aliases":[]},{"answer":"Tellurium","aliases":[]},{"answer":"Iodine","aliases":[]},{"answer":"Xenon","aliases":[]},{"answer":"Caesium","aliases":["Cesium"]},{"answer":"Barium","aliases":[]},{"answer":"Lanthanum","aliases":[]},{"answer":"Cerium","aliases":[]},{"answer":"Praseodymium","aliases":[]},{"answer":"Neodymium","aliases":[]},{"answer":"Promethium","aliases":[]},{"answer":"Samarium","aliases":[]},{"answer":"Europium","aliases":[]},{"answer":"Gadolinium","aliases":[]},{"answer":"Terbium","aliases":[]},{"answer":"Dysprosium","aliases":[]},{"answer":"Holmium","aliases":[]},{"answer":"Erbium","aliases":[]},{"answer":"Thulium","aliases":[]},{"answer":"Ytterbium","aliases":[]},{"answer":"Lutetium","aliases":[]},{"answer":"Hafnium","aliases":[]},{"answer":"Tantalum","aliases":[]},{"answer":"Tungsten","aliases":[]},{"answer":"Rhenium","aliases":[]},{"answer":"Osmium","aliases":[]},{"answer":"Iridium","aliases":[]},{"answer":"Platinum","aliases":[]},{"answer":"Gold","aliases":[]},{"answer":"Mercury","aliases":[]},{"answer":"Thallium","aliases":[]},{"answer":"Lead","aliases":[]},{"answer":"Bismuth","aliases":[]},{"answer":"Polonium","aliases":[]},{"answer":"Astatine","aliases":[]},{"answer":"Radon","aliases":[]},{"answer":"Francium","aliases":[]},{"answer":"Radium","aliases":[]},{"answer":"Actinium","aliases":[]},{"answer":"Thorium","aliases":[]},{"answer":"Protactinium","aliases":[]},{"answer":"Uranium","aliases":[]},{"answer":"Neptunium","aliases":[]},{"answer":"Plutonium","aliases":[]},{"answer":"Americium","aliases":[]},{"answer":"Curium","aliases":[]},{"answer":"Berkelium","aliases":[]},{"answer":"Californium","aliases":[]},{"answer":"Einsteinium","aliases":[]},{"answer":"Fermium","aliases":[]},{"answer":"Mendelevium","aliases":[]},{"answer":"Nobelium","aliases":[]},{"answer":"Lawrencium","aliases":[]},{"answer":"Rutherfordium","aliases":[]},{"answer":"Dubnium","aliases":[]},{"answer":"Seaborgium","aliases":[]},{"answer":"Bohrium","aliases":[]},{"answer":"Hassium","aliases":[]},{"answer":"Meitnerium","aliases":[]},{"answer":"Darmstadtium","aliases":[]},{"answer":"Roentgenium","aliases":[]},{"answer":"Copernicium","aliases":[]},{"answer":"Nihonium","aliases":[]},{"answer":"Flerovium","aliases":[]},{"answer":"Moscovium","aliases":[]},{"answer":"Livermorium","aliases":[]},{"answer":"Tennessine","aliases":[]},{"answer":"Oganesson","aliases":[]}]'::jsonb);
select public._seed_brainilab_topic_rush('greek-alphabet','Greek alphabet letters','Name letters of the Greek alphabet.',12,'[{"answer":"Alpha","aliases":[]},{"answer":"Beta","aliases":[]},{"answer":"Gamma","aliases":[]},{"answer":"Delta","aliases":[]},{"answer":"Epsilon","aliases":[]},{"answer":"Zeta","aliases":[]},{"answer":"Eta","aliases":[]},{"answer":"Theta","aliases":[]},{"answer":"Iota","aliases":[]},{"answer":"Kappa","aliases":[]},{"answer":"Lambda","aliases":[]},{"answer":"Mu","aliases":[]},{"answer":"Nu","aliases":[]},{"answer":"Xi","aliases":[]},{"answer":"Omicron","aliases":[]},{"answer":"Pi","aliases":[]},{"answer":"Rho","aliases":[]},{"answer":"Sigma","aliases":[]},{"answer":"Tau","aliases":[]},{"answer":"Upsilon","aliases":[]},{"answer":"Phi","aliases":[]},{"answer":"Chi","aliases":[]},{"answer":"Psi","aliases":[]},{"answer":"Omega","aliases":[]}]'::jsonb);
select public._seed_brainilab_topic_rush('nato-alphabet','NATO phonetic alphabet','Name code words from the NATO phonetic alphabet.',12,'[{"answer":"Alfa","aliases":["Alpha"]},{"answer":"Bravo","aliases":[]},{"answer":"Charlie","aliases":[]},{"answer":"Delta","aliases":[]},{"answer":"Echo","aliases":[]},{"answer":"Foxtrot","aliases":[]},{"answer":"Golf","aliases":[]},{"answer":"Hotel","aliases":[]},{"answer":"India","aliases":[]},{"answer":"Juliett","aliases":["Juliet"]},{"answer":"Kilo","aliases":[]},{"answer":"Lima","aliases":[]},{"answer":"Mike","aliases":[]},{"answer":"November","aliases":[]},{"answer":"Oscar","aliases":[]},{"answer":"Papa","aliases":[]},{"answer":"Quebec","aliases":[]},{"answer":"Romeo","aliases":[]},{"answer":"Sierra","aliases":[]},{"answer":"Tango","aliases":[]},{"answer":"Uniform","aliases":[]},{"answer":"Victor","aliases":[]},{"answer":"Whiskey","aliases":[]},{"answer":"X-ray","aliases":["Xray","X Ray"]},{"answer":"Yankee","aliases":[]},{"answer":"Zulu","aliases":[]}]'::jsonb);
select public._seed_brainilab_topic_rush('premier-league-2026-27','Premier League clubs','Name clubs playing in the 2026/27 English Premier League.',12,'[{"answer":"AFC Bournemouth","aliases":["Bournemouth"]},{"answer":"Arsenal","aliases":[]},{"answer":"Aston Villa","aliases":[]},{"answer":"Brentford","aliases":[]},{"answer":"Brighton & Hove Albion","aliases":["Brighton","Brighton and Hove Albion"]},{"answer":"Chelsea","aliases":[]},{"answer":"Coventry City","aliases":[]},{"answer":"Crystal Palace","aliases":[]},{"answer":"Everton","aliases":[]},{"answer":"Fulham","aliases":[]},{"answer":"Hull City","aliases":[]},{"answer":"Ipswich Town","aliases":[]},{"answer":"Leeds United","aliases":[]},{"answer":"Liverpool","aliases":[]},{"answer":"Manchester City","aliases":["Man City"]},{"answer":"Manchester United","aliases":["Man United","Man Utd"]},{"answer":"Newcastle United","aliases":["Newcastle"]},{"answer":"Nottingham Forest","aliases":["Nottm Forest","Forest"]},{"answer":"Sunderland","aliases":[]},{"answer":"Tottenham Hotspur","aliases":["Tottenham","Spurs"]}]'::jsonb);
select public._seed_brainilab_topic_rush('nba-teams','NBA teams','Name current NBA teams.',15,'[{"answer":"Atlanta Hawks","aliases":["Hawks"]},{"answer":"Boston Celtics","aliases":["Celtics"]},{"answer":"Brooklyn Nets","aliases":["Nets"]},{"answer":"Charlotte Hornets","aliases":["Hornets"]},{"answer":"Chicago Bulls","aliases":["Bulls"]},{"answer":"Cleveland Cavaliers","aliases":["Cavaliers"]},{"answer":"Dallas Mavericks","aliases":["Mavericks"]},{"answer":"Denver Nuggets","aliases":["Nuggets"]},{"answer":"Detroit Pistons","aliases":["Pistons"]},{"answer":"Golden State Warriors","aliases":["Warriors"]},{"answer":"Houston Rockets","aliases":["Rockets"]},{"answer":"Indiana Pacers","aliases":["Pacers"]},{"answer":"LA Clippers","aliases":["Los Angeles Clippers","Clippers"]},{"answer":"Los Angeles Lakers","aliases":["Lakers"]},{"answer":"Memphis Grizzlies","aliases":["Grizzlies"]},{"answer":"Miami Heat","aliases":["Heat"]},{"answer":"Milwaukee Bucks","aliases":["Bucks"]},{"answer":"Minnesota Timberwolves","aliases":["Timberwolves"]},{"answer":"New Orleans Pelicans","aliases":["Pelicans"]},{"answer":"New York Knicks","aliases":["Knicks"]},{"answer":"Oklahoma City Thunder","aliases":["Thunder"]},{"answer":"Orlando Magic","aliases":["Magic"]},{"answer":"Philadelphia 76ers","aliases":["76ers","Sixers"]},{"answer":"Phoenix Suns","aliases":["Suns"]},{"answer":"Portland Trail Blazers","aliases":["Blazers"]},{"answer":"Sacramento Kings","aliases":["Kings"]},{"answer":"San Antonio Spurs","aliases":["Spurs"]},{"answer":"Toronto Raptors","aliases":["Raptors"]},{"answer":"Utah Jazz","aliases":["Jazz"]},{"answer":"Washington Wizards","aliases":["Wizards"]}]'::jsonb);
select public._seed_brainilab_topic_rush('nfl-teams','NFL teams','Name current NFL teams.',15,'[{"answer":"Arizona Cardinals","aliases":["Cardinals"]},{"answer":"Atlanta Falcons","aliases":["Falcons"]},{"answer":"Baltimore Ravens","aliases":["Ravens"]},{"answer":"Buffalo Bills","aliases":["Bills"]},{"answer":"Carolina Panthers","aliases":["Panthers"]},{"answer":"Chicago Bears","aliases":["Bears"]},{"answer":"Cincinnati Bengals","aliases":["Bengals"]},{"answer":"Cleveland Browns","aliases":["Browns"]},{"answer":"Dallas Cowboys","aliases":["Cowboys"]},{"answer":"Denver Broncos","aliases":["Broncos"]},{"answer":"Detroit Lions","aliases":["Lions"]},{"answer":"Green Bay Packers","aliases":["Packers"]},{"answer":"Houston Texans","aliases":["Texans"]},{"answer":"Indianapolis Colts","aliases":["Colts"]},{"answer":"Jacksonville Jaguars","aliases":["Jaguars"]},{"answer":"Kansas City Chiefs","aliases":["Chiefs","KC Chiefs"]},{"answer":"Las Vegas Raiders","aliases":["Raiders"]},{"answer":"Los Angeles Chargers","aliases":["Chargers"]},{"answer":"Los Angeles Rams","aliases":["Rams"]},{"answer":"Miami Dolphins","aliases":["Dolphins"]},{"answer":"Minnesota Vikings","aliases":["Vikings"]},{"answer":"New England Patriots","aliases":["Patriots"]},{"answer":"New Orleans Saints","aliases":["Saints"]},{"answer":"New York Giants","aliases":["Giants"]},{"answer":"New York Jets","aliases":["Jets"]},{"answer":"Philadelphia Eagles","aliases":["Eagles"]},{"answer":"Pittsburgh Steelers","aliases":["Steelers"]},{"answer":"San Francisco 49ers","aliases":["49ers","49ers","Niners"]},{"answer":"Seattle Seahawks","aliases":["Seahawks"]},{"answer":"Tampa Bay Buccaneers","aliases":["Buccaneers","Bucs"]},{"answer":"Tennessee Titans","aliases":["Titans"]},{"answer":"Washington Commanders","aliases":["Commanders"]}]'::jsonb);
select public._seed_brainilab_topic_rush('mlb-teams','MLB teams','Name current Major League Baseball teams.',15,'[{"answer":"Arizona Diamondbacks","aliases":["Diamondbacks"]},{"answer":"Atlanta Braves","aliases":["Braves"]},{"answer":"Baltimore Orioles","aliases":["Orioles"]},{"answer":"Boston Red Sox","aliases":["Red Sox"]},{"answer":"Chicago Cubs","aliases":["Cubs"]},{"answer":"Chicago White Sox","aliases":["White Sox"]},{"answer":"Cincinnati Reds","aliases":["Reds"]},{"answer":"Cleveland Guardians","aliases":["Guardians"]},{"answer":"Colorado Rockies","aliases":["Rockies"]},{"answer":"Detroit Tigers","aliases":["Tigers"]},{"answer":"Houston Astros","aliases":["Astros"]},{"answer":"Kansas City Royals","aliases":["Royals"]},{"answer":"Los Angeles Angels","aliases":["Angels"]},{"answer":"Los Angeles Dodgers","aliases":["Dodgers"]},{"answer":"Miami Marlins","aliases":["Marlins"]},{"answer":"Milwaukee Brewers","aliases":["Brewers"]},{"answer":"Minnesota Twins","aliases":["Twins"]},{"answer":"New York Mets","aliases":["Mets"]},{"answer":"New York Yankees","aliases":["Yankees"]},{"answer":"Athletics","aliases":["Athletics","A''s","As","Oakland Athletics"]},{"answer":"Philadelphia Phillies","aliases":["Phillies"]},{"answer":"Pittsburgh Pirates","aliases":["Pirates"]},{"answer":"San Diego Padres","aliases":["Padres"]},{"answer":"San Francisco Giants","aliases":["Giants"]},{"answer":"Seattle Mariners","aliases":["Mariners"]},{"answer":"St. Louis Cardinals","aliases":["Cardinals","St Louis Cardinals"]},{"answer":"Tampa Bay Rays","aliases":["Rays"]},{"answer":"Texas Rangers","aliases":["Rangers"]},{"answer":"Toronto Blue Jays","aliases":["Jays","Blue Jays"]},{"answer":"Washington Nationals","aliases":["Nationals"]}]'::jsonb);

select public._seed_brainilab_topic_rush('common-colors','Common colors','Name common color names.',15,'[{"answer":"Red","aliases":[]},{"answer":"Orange","aliases":[]},{"answer":"Yellow","aliases":[]},{"answer":"Green","aliases":[]},{"answer":"Blue","aliases":[]},{"answer":"Purple","aliases":["Violet"]},{"answer":"Pink","aliases":[]},{"answer":"Brown","aliases":[]},{"answer":"Black","aliases":[]},{"answer":"White","aliases":[]},{"answer":"Grey","aliases":["Gray"]},{"answer":"Beige","aliases":[]},{"answer":"Turquoise","aliases":[]},{"answer":"Teal","aliases":[]},{"answer":"Cyan","aliases":[]},{"answer":"Magenta","aliases":[]},{"answer":"Maroon","aliases":[]},{"answer":"Navy","aliases":["Navy Blue"]},{"answer":"Olive","aliases":[]},{"answer":"Lime","aliases":["Lime Green"]},{"answer":"Gold","aliases":[]},{"answer":"Silver","aliases":[]},{"answer":"Coral","aliases":[]},{"answer":"Indigo","aliases":[]},{"answer":"Lavender","aliases":[]},{"answer":"Peach","aliases":[]},{"answer":"Cream","aliases":[]},{"answer":"Khaki","aliases":[]}]'::jsonb);
select public._seed_brainilab_topic_rush('musical-instruments','Musical instruments','Name common musical instruments.',15,'[{"answer":"Piano","aliases":[]},{"answer":"Guitar","aliases":[]},{"answer":"Violin","aliases":[]},{"answer":"Viola","aliases":[]},{"answer":"Cello","aliases":[]},{"answer":"Double bass","aliases":["Upright Bass"]},{"answer":"Harp","aliases":[]},{"answer":"Flute","aliases":[]},{"answer":"Piccolo","aliases":[]},{"answer":"Clarinet","aliases":[]},{"answer":"Oboe","aliases":[]},{"answer":"Bassoon","aliases":[]},{"answer":"Saxophone","aliases":["Sax"]},{"answer":"Trumpet","aliases":[]},{"answer":"Trombone","aliases":[]},{"answer":"French horn","aliases":["Horn"]},{"answer":"Tuba","aliases":[]},{"answer":"Drums","aliases":["Drum Kit","Drum Set"]},{"answer":"Xylophone","aliases":[]},{"answer":"Marimba","aliases":[]},{"answer":"Accordion","aliases":[]},{"answer":"Harmonica","aliases":[]},{"answer":"Banjo","aliases":[]},{"answer":"Ukulele","aliases":["Uke"]},{"answer":"Mandolin","aliases":[]},{"answer":"Organ","aliases":[]},{"answer":"Synthesizer","aliases":["Synth"]},{"answer":"Recorder","aliases":[]},{"answer":"Bagpipes","aliases":["Bagpipe"]},{"answer":"Tambourine","aliases":[]},{"answer":"Triangle","aliases":[]},{"answer":"Cymbals","aliases":["Cymbal"]},{"answer":"Bongos","aliases":["Bongo Drums"]},{"answer":"Congas","aliases":["Conga Drums"]},{"answer":"Lute","aliases":[]},{"answer":"Sitar","aliases":[]}]'::jsonb);
select public._seed_brainilab_topic_rush('common-fruits','Common fruits','Name common fruits.',15,'[{"answer":"Apple","aliases":[]},{"answer":"Banana","aliases":[]},{"answer":"Orange","aliases":[]},{"answer":"Pear","aliases":[]},{"answer":"Peach","aliases":[]},{"answer":"Plum","aliases":[]},{"answer":"Cherry","aliases":[]},{"answer":"Strawberry","aliases":[]},{"answer":"Raspberry","aliases":[]},{"answer":"Blueberry","aliases":[]},{"answer":"Blackberry","aliases":[]},{"answer":"Grape","aliases":["Grapes"]},{"answer":"Watermelon","aliases":[]},{"answer":"Melon","aliases":[]},{"answer":"Pineapple","aliases":[]},{"answer":"Mango","aliases":[]},{"answer":"Papaya","aliases":[]},{"answer":"Kiwi","aliases":["Kiwifruit"]},{"answer":"Lemon","aliases":[]},{"answer":"Lime","aliases":[]},{"answer":"Grapefruit","aliases":[]},{"answer":"Apricot","aliases":[]},{"answer":"Fig","aliases":[]},{"answer":"Pomegranate","aliases":[]},{"answer":"Coconut","aliases":[]},{"answer":"Avocado","aliases":[]},{"answer":"Guava","aliases":[]},{"answer":"Passion fruit","aliases":["Passionfruit"]},{"answer":"Dragon fruit","aliases":["Dragonfruit","Pitaya"]},{"answer":"Lychee","aliases":["Litchi"]},{"answer":"Nectarine","aliases":[]},{"answer":"Persimmon","aliases":[]}]'::jsonb);
select public._seed_brainilab_topic_rush('european-countries','Countries in Europe','Name sovereign countries in Europe.',15,'[{"answer":"Albania","aliases":[]},{"answer":"Andorra","aliases":[]},{"answer":"Austria","aliases":[]},{"answer":"Belarus","aliases":[]},{"answer":"Belgium","aliases":[]},{"answer":"Bosnia and Herzegovina","aliases":["Bosnia"]},{"answer":"Bulgaria","aliases":[]},{"answer":"Croatia","aliases":[]},{"answer":"Cyprus","aliases":[]},{"answer":"Czechia","aliases":["Czech Republic"]},{"answer":"Denmark","aliases":[]},{"answer":"Estonia","aliases":[]},{"answer":"Finland","aliases":[]},{"answer":"France","aliases":[]},{"answer":"Germany","aliases":[]},{"answer":"Greece","aliases":[]},{"answer":"Hungary","aliases":[]},{"answer":"Iceland","aliases":[]},{"answer":"Ireland","aliases":[]},{"answer":"Italy","aliases":[]},{"answer":"Latvia","aliases":[]},{"answer":"Liechtenstein","aliases":[]},{"answer":"Lithuania","aliases":[]},{"answer":"Luxembourg","aliases":[]},{"answer":"Malta","aliases":[]},{"answer":"Moldova","aliases":[]},{"answer":"Monaco","aliases":[]},{"answer":"Montenegro","aliases":[]},{"answer":"Netherlands","aliases":["The Netherlands","Holland"]},{"answer":"North Macedonia","aliases":["Macedonia"]},{"answer":"Norway","aliases":[]},{"answer":"Poland","aliases":[]},{"answer":"Portugal","aliases":[]},{"answer":"Romania","aliases":[]},{"answer":"San Marino","aliases":[]},{"answer":"Serbia","aliases":[]},{"answer":"Slovakia","aliases":[]},{"answer":"Slovenia","aliases":[]},{"answer":"Spain","aliases":[]},{"answer":"Sweden","aliases":[]},{"answer":"Switzerland","aliases":[]},{"answer":"Ukraine","aliases":[]},{"answer":"United Kingdom","aliases":["UK","Great Britain"]},{"answer":"Vatican City","aliases":["Vatican"]}]'::jsonb);
select public._seed_brainilab_topic_rush('world-currencies','World currencies','Name currencies used by countries around the world.',15,'[{"answer":"Euro","aliases":["EUR"]},{"answer":"US dollar","aliases":["Dollar","USD","United States Dollar"]},{"answer":"Pound sterling","aliases":["British Pound","GBP","Sterling"]},{"answer":"Japanese yen","aliases":["Yen","JPY"]},{"answer":"Chinese yuan","aliases":["Yuan","Renminbi","CNY"]},{"answer":"Swiss franc","aliases":["Franc","CHF"]},{"answer":"Canadian dollar","aliases":["CAD"]},{"answer":"Australian dollar","aliases":["AUD"]},{"answer":"New Zealand dollar","aliases":["NZD"]},{"answer":"Indian rupee","aliases":["Rupee","INR"]},{"answer":"South Korean won","aliases":["Won","KRW"]},{"answer":"Mexican peso","aliases":["Peso","MXN"]},{"answer":"Brazilian real","aliases":["Real","BRL"]},{"answer":"Argentine peso","aliases":["ARS"]},{"answer":"Chilean peso","aliases":["CLP"]},{"answer":"Colombian peso","aliases":["COP"]},{"answer":"South African rand","aliases":["Rand","ZAR"]},{"answer":"Turkish lira","aliases":["Lira","TRY"]},{"answer":"Swedish krona","aliases":["Krona","SEK"]},{"answer":"Norwegian krone","aliases":["Krone","NOK"]},{"answer":"Danish krone","aliases":["DKK"]},{"answer":"Polish zloty","aliases":["Zloty","PLN"]},{"answer":"Czech koruna","aliases":["Koruna","CZK"]},{"answer":"Hungarian forint","aliases":["Forint","HUF"]},{"answer":"Romanian leu","aliases":["Leu","RON"]},{"answer":"Israeli new shekel","aliases":["Shekel","ILS"]},{"answer":"Saudi riyal","aliases":["Riyal","SAR"]},{"answer":"UAE dirham","aliases":["Dirham","AED"]},{"answer":"Thai baht","aliases":["Baht","THB"]},{"answer":"Indonesian rupiah","aliases":["Rupiah","IDR"]},{"answer":"Malaysian ringgit","aliases":["Ringgit","MYR"]},{"answer":"Singapore dollar","aliases":["SGD"]},{"answer":"Philippine peso","aliases":["PHP"]},{"answer":"Egyptian pound","aliases":["EGP"]}]'::jsonb);

drop function if exists public._seed_brainilab_topic_rush(text,text,text,integer,jsonb);

-- ============================================================
-- DAILY TOPIC ASSIGNMENT
-- ============================================================

create or replace function public.ensure_brainilab_topic_rush(
  p_daily_challenge_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_date date;
  v_launch date;
  v_cooldown integer;
  v_topic_id uuid;
begin
  select
    dc.challenge_date,
    trs.launch_date,
    trs.cooldown_days
  into
    v_date,
    v_launch,
    v_cooldown
  from public.daily_challenges dc
  cross join public.topic_rush_settings trs
  where dc.id=p_daily_challenge_id
    and trs.singleton=true;

  if v_date is null then
    raise exception 'Daily challenge not found';
  end if;

  if v_date<v_launch then
    return;
  end if;

  if exists(
    select 1
    from public.daily_topic_rush dtr
    where dtr.daily_challenge_id=p_daily_challenge_id
  ) then
    return;
  end if;

  -- Prefer a topic not used inside the configured cooldown.
  select trt.id
    into v_topic_id
  from public.topic_rush_topics trt
  where trt.is_active=true
    and (
      select count(*)
      from public.topic_rush_answers tra
      where tra.topic_id=trt.id
    )>=trt.target_count
    and not exists(
      select 1
      from public.daily_topic_rush old
      join public.daily_challenges odc
        on odc.id=old.daily_challenge_id
      where old.topic_id=trt.id
        and odc.challenge_date<v_date
        and odc.challenge_date>=v_date-v_cooldown
    )
  order by md5(trt.id::text||':'||v_date::text)
  limit 1;

  -- Graceful fallback: least recently used active topic.
  if v_topic_id is null then
    select trt.id
      into v_topic_id
    from public.topic_rush_topics trt
    where trt.is_active=true
      and (
        select count(*)
        from public.topic_rush_answers tra
        where tra.topic_id=trt.id
      )>=trt.target_count
    order by (
      select max(odc.challenge_date)
      from public.daily_topic_rush old
      join public.daily_challenges odc
        on odc.id=old.daily_challenge_id
      where old.topic_id=trt.id
    ) asc nulls first,
    md5(trt.id::text||':'||v_date::text)
    limit 1;
  end if;

  if v_topic_id is null then
    raise exception 'No eligible Topic Rush topic is available';
  end if;

  insert into public.daily_topic_rush(
    daily_challenge_id,
    topic_id
  )
  values(
    p_daily_challenge_id,
    v_topic_id
  )
  on conflict(daily_challenge_id) do nothing;
end;
$$;

revoke execute on function public.ensure_brainilab_topic_rush(uuid)
  from public,anon,authenticated;


-- Step 12 retires Map Hunt from newly generated Daily content.
-- Keep historical/today Map Hunt rows for compatibility, but future Daily rows
-- contain only BrainiWord + Flag Dash here; Topic Rush is generated separately.
create or replace function public.ensure_brainilab_daily_games(
  p_daily_challenge_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_date date;
  v_word_id uuid;
  v_row record;
  v_position integer;
  v_country_id uuid;
  v_options uuid[];
  v_distractors uuid[];
  v_count integer;
begin
  select challenge_date
    into v_date
  from public.daily_challenges
  where id=p_daily_challenge_id;

  if v_date is null then
    raise exception 'Daily challenge not found';
  end if;

  -- BrainiWord: avoid previous 60 days if possible.
  if not exists(
    select 1 from public.daily_brainiword
    where daily_challenge_id=p_daily_challenge_id
  ) then
    select bw.id
      into v_word_id
    from public.brainiword_words bw
    where bw.is_active=true
      and not exists(
        select 1
        from public.daily_brainiword dbw
        join public.daily_challenges dc
          on dc.id=dbw.daily_challenge_id
        where dbw.word_id=bw.id
          and dc.challenge_date<v_date
          and dc.challenge_date>=v_date-60
      )
    order by md5(bw.id::text||':'||v_date::text)
    limit 1;

    if v_word_id is null then
      select bw.id
        into v_word_id
      from public.brainiword_words bw
      where bw.is_active=true
      order by (
        select max(dc.challenge_date)
        from public.daily_brainiword old
        join public.daily_challenges dc
          on dc.id=old.daily_challenge_id
        where old.word_id=bw.id
      ) asc nulls first,
      md5(bw.id::text||':'||v_date::text)
      limit 1;
    end if;

    insert into public.daily_brainiword(
      daily_challenge_id,
      word_id
    )
    values(
      p_daily_challenge_id,
      v_word_id
    );
  end if;

  -- Flag Dash: deterministic 30-country daily set.
  if not exists(
    select 1 from public.daily_flag_dash_questions
    where daily_challenge_id=p_daily_challenge_id
  ) then
    v_position:=0;

    for v_row in
      select c.id
      from public.daily_countries c
      where c.is_active=true
      order by md5(c.id::text||':flag:'||v_date::text)
      limit 30
    loop
      v_position:=v_position+1;
      v_country_id:=v_row.id;

      select array_agg(
        x.id
        order by md5(
          x.id::text||':d:'||v_date::text||':'||v_position::text
        )
      )
      into v_distractors
      from (
        select c2.id
        from public.daily_countries c2
        where c2.is_active=true
          and c2.id<>v_country_id
        order by md5(
          c2.id::text||':flagopt:'||v_date::text||':'||v_position::text
        )
        limit 3
      ) x;

      select array_agg(
        u
        order by md5(
          u::text||':order:'||v_date::text||':'||v_position::text
        )
      )
      into v_options
      from unnest(array_append(v_distractors,v_country_id)) u;

      insert into public.daily_flag_dash_questions(
        daily_challenge_id,
        position,
        country_id,
        option_country_ids
      )
      values(
        p_daily_challenge_id,
        v_position,
        v_country_id,
        v_options
      );
    end loop;
  end if;

  select count(*) into v_count
  from public.daily_flag_dash_questions
  where daily_challenge_id=p_daily_challenge_id;

  if v_count<>30 then
    raise exception 'Flag Dash Daily must contain 30 questions, got %',v_count;
  end if;
end;
$$;

revoke execute on function public.ensure_brainilab_daily_games(uuid)
  from public,anon,authenticated;

-- Remove only unused FUTURE Map Hunt generated rows. Today's/historical rows stay
-- intact so any already-seen or pending legacy results remain verifiable.
delete from public.daily_map_hunt_questions dmq
using public.daily_challenges dc
where dc.id=dmq.daily_challenge_id
  and dc.challenge_date>current_date;

-- Extend Step 7's automatic Daily trigger without changing the Step 5 Cron.
create or replace function public.handle_brainilab_daily_games_generation()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.ensure_brainilab_daily_games(new.id);
  perform public.ensure_brainilab_topic_rush(new.id);
  return new;
end;
$$;


-- Backfill Topic Rush assignments for today + already-generated future Dailies.
do $$
declare
  v_daily record;
  v_launch date;
begin
  select launch_date into v_launch
  from public.topic_rush_settings
  where singleton=true;

  for v_daily in
    select dc.id
    from public.daily_challenges dc
    where dc.challenge_date>=v_launch
    order by dc.challenge_date
  loop
    perform public.ensure_brainilab_topic_rush(v_daily.id);
  end loop;
end;
$$;


-- ============================================================
-- PUBLIC TOPIC RUSH GAMEPLAY RPCs
-- ============================================================

create or replace function public.get_brainilab_daily_topic_rush()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_row record;
begin
  select
    dc.id as daily_challenge_id,
    dc.daily_number,
    dc.challenge_date,
    trt.id as topic_id,
    trt.title,
    trt.prompt,
    trt.target_count,
    trs.duration_seconds
  into v_row
  from public.daily_challenges dc
  join public.daily_topic_rush dtr
    on dtr.daily_challenge_id=dc.id
  join public.topic_rush_topics trt
    on trt.id=dtr.topic_id
  cross join public.topic_rush_settings trs
  where dc.challenge_date=current_date
    and dc.status='published'
    and trs.singleton=true
    and current_date>=trs.launch_date
  limit 1;

  if v_row.daily_challenge_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'daily_challenge_id',v_row.daily_challenge_id,
    'daily_number',v_row.daily_number,
    'challenge_date',v_row.challenge_date,
    'topic_id',v_row.topic_id,
    'title',v_row.title,
    'prompt',v_row.prompt,
    'target_count',v_row.target_count,
    'duration_seconds',v_row.duration_seconds
  );
end;
$$;

revoke execute on function public.get_brainilab_daily_topic_rush()
  from public;

grant execute on function public.get_brainilab_daily_topic_rush()
  to anon,authenticated;


create or replace function public.check_brainilab_topic_rush_answer(
  p_daily_challenge_id uuid,
  p_guess text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_norm text;
  v_answer record;
begin
  v_norm:=public.brainilab_normalize_topic_rush_answer(p_guess);

  if char_length(v_norm)<2 then
    return jsonb_build_object(
      'valid',false,
      'reason','too_short'
    );
  end if;

  select
    tra.id,
    tra.answer_text
  into v_answer
  from public.daily_topic_rush dtr
  join public.topic_rush_answers tra
    on tra.topic_id=dtr.topic_id
  join public.daily_challenges dc
    on dc.id=dtr.daily_challenge_id
  where dtr.daily_challenge_id=p_daily_challenge_id
    and dc.challenge_date=current_date
    and dc.status='published'
    and (
      tra.normalized_answer=v_norm
      or v_norm=any(tra.normalized_aliases)
    )
  limit 1;

  if v_answer.id is null then
    return jsonb_build_object(
      'valid',false,
      'reason','not_in_list'
    );
  end if;

  return jsonb_build_object(
    'valid',true,
    'answer_id',v_answer.id,
    'canonical_answer',v_answer.answer_text
  );
end;
$$;

revoke execute on function public.check_brainilab_topic_rush_answer(
  uuid,text
) from public;

grant execute on function public.check_brainilab_topic_rush_answer(
  uuid,text
) to anon,authenticated;


create or replace function public.verify_brainilab_topic_rush_result(
  p_client_result_id text,
  p_daily_challenge_id uuid,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user_id uuid:=auth.uid();
  v_session_id uuid;
  v_result_id uuid;
  v_daily_number integer;
  v_target integer;
  v_topic_id uuid;
  v_answer jsonb;
  v_norm text;
  v_answer_id uuid;
  v_valid_ids uuid[]:='{}'::uuid[];
  v_correct integer:=0;
  v_score integer:=0;
  v_accuracy numeric:=0;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if jsonb_typeof(coalesce(p_answers,'[]'::jsonb))<>'array' then
    raise exception 'Topic Rush answers must be an array';
  end if;

  if jsonb_array_length(p_answers)>120 then
    raise exception 'Too many Topic Rush submissions';
  end if;

  select
    gs.id,
    gr.id
  into
    v_session_id,
    v_result_id
  from public.game_sessions gs
  join public.game_results gr
    on gr.session_id=gs.id
  where gs.user_id=v_user_id
    and gs.client_result_id=p_client_result_id
    and gs.game_id='topicrush'
  limit 1;

  if v_result_id is null then
    raise exception 'Topic Rush result not found';
  end if;

  select
    dc.daily_number,
    dtr.topic_id,
    trt.target_count
  into
    v_daily_number,
    v_topic_id,
    v_target
  from public.daily_challenges dc
  join public.daily_topic_rush dtr
    on dtr.daily_challenge_id=dc.id
  join public.topic_rush_topics trt
    on trt.id=dtr.topic_id
  where dc.id=p_daily_challenge_id
    and dc.status in ('published','retired');

  if v_topic_id is null then
    raise exception 'Topic Rush Daily not found';
  end if;

  update public.game_sessions
  set
    daily_challenge_id=p_daily_challenge_id,
    daily_number=v_daily_number
  where id=v_session_id;

  for v_answer in
    select value
    from jsonb_array_elements(p_answers)
  loop
    v_norm:=public.brainilab_normalize_topic_rush_answer(
      coalesce(v_answer#>>'{}','')
    );

    if v_norm='' then
      continue;
    end if;

    select tra.id
      into v_answer_id
    from public.topic_rush_answers tra
    where tra.topic_id=v_topic_id
      and (
        tra.normalized_answer=v_norm
        or v_norm=any(tra.normalized_aliases)
      )
    limit 1;

    if v_answer_id is not null
       and not (v_answer_id=any(v_valid_ids)) then
      v_valid_ids:=array_append(v_valid_ids,v_answer_id);
    end if;
  end loop;

  v_correct:=coalesce(cardinality(v_valid_ids),0);
  v_score:=least(
    2500,
    greatest(
      0,
      round(
        v_correct::numeric
        / greatest(v_target,1)::numeric
        * 2500
      )::integer
    )
  );

  v_accuracy:=least(
    100,
    round(
      v_correct::numeric
      / greatest(v_target,1)::numeric
      * 100,
      2
    )
  );

  update public.game_results
  set
    score=v_score,
    correct_answers=v_correct,
    total_questions=v_target,
    accuracy=v_accuracy,
    answers_verified=true,
    verified_correct_answers=v_correct,
    verified_total_questions=v_target,
    answers_verified_at=now(),
    result_payload=
      coalesce(result_payload,'{}'::jsonb)
      || jsonb_build_object(
        'verifiedTargetCount',v_target,
        'verifiedTopicId',v_topic_id,
        'verifiedValidAnswers',v_correct
      )
  where id=v_result_id;

  return jsonb_build_object(
    'answers_verified',true,
    'daily_number',v_daily_number,
    'correct',v_correct,
    'total',v_target,
    'accuracy',v_accuracy,
    'score',v_score,
    'daily_points',v_score,
    'server_score_verified',false
  );
end;
$$;

revoke execute on function public.verify_brainilab_topic_rush_result(
  text,uuid,jsonb
) from public,anon;

grant execute on function public.verify_brainilab_topic_rush_result(
  text,uuid,jsonb
) to authenticated;

-- ============================================================
-- PLAYER PROGRESSION / DAILY BRAIN SCORE
-- ============================================================

alter table public.player_daily_stats
  add column if not exists topicrush_points integer not null default 0;

alter table public.player_daily_stats
  drop constraint if exists player_daily_points_range;

alter table public.player_daily_stats
  add constraint player_daily_points_range
  check(
    brainmix_points between 0 and 2500
    and flagdash_points between 0 and 2500
    and maphunt_points between 0 and 2500
    and topicrush_points between 0 and 2500
    and brainiword_points between 0 and 2500
    and daily_brain_score between 0 and 10000
  );

create index if not exists player_daily_topicrush_rank_idx
  on public.player_daily_stats(stat_date,topicrush_points desc);

create or replace function public.brainilab_daily_game_points(
  p_game_id text,
  p_score integer,
  p_correct integer,
  p_payload jsonb
)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  v_points integer := 0;
  v_attempts integer;
  v_won boolean := false;
  v_best_combo integer := 0;
begin
  if p_game_id = 'brainmix' then
    v_points := least(
      2500,
      greatest(0,round(coalesce(p_score,0) * 0.25)::integer)
    );

  elsif p_game_id = 'flagdash' then
    begin
      v_best_combo := coalesce((p_payload ->> 'bestCombo')::integer,0);
    exception when others then
      v_best_combo := 0;
    end;

    v_points := least(
      2500,
      greatest(
        0,
        coalesce(p_correct,0) * 70 + v_best_combo * 15
      )
    );

  elsif p_game_id = 'topicrush' then
    -- Topic Rush final score is already the canonical 0–2,500 Daily contribution.
    v_points := least(
      2500,
      greatest(0,coalesce(p_score,0))
    );

  elsif p_game_id = 'maphunt' then
    -- Legacy Map Hunt scoring remains for historical days before Topic Rush launch.
    v_points := least(
      2500,
      greatest(0,round(coalesce(p_score,0) * 0.42)::integer)
    );

  elsif p_game_id = 'brainiword' then
    v_won := lower(coalesce(p_payload ->> 'won','false')) = 'true';

    begin
      v_attempts := (p_payload ->> 'attempts')::integer;
    exception when others then
      v_attempts := null;
    end;

    if not v_won then
      v_points := 250;
    else
      v_points := case v_attempts
        when 1 then 2500
        when 2 then 2250
        when 3 then 2000
        when 4 then 1750
        when 5 then 1500
        else 1000
      end;
    end if;
  end if;

  return least(2500,greatest(0,coalesce(v_points,0)));
end;
$$;

create or replace function public.refresh_brainilab_player_progression(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'UTC')::date;
  v_current_streak integer := 0;
  v_best_streak integer := 0;
  v_run integer := 0;
  v_previous_date date := null;
  v_last_streak_date date := null;

  v_total_games integer := 0;
  v_total_questions bigint := 0;
  v_full_daily_count integer := 0;
  v_xp bigint := 0;
  v_level integer := 1;
  v_favorite_game text := null;
  v_last_active_at timestamptz := null;

  v_day record;
  v_topicrush_launch_date date;
begin
  if p_user_id is null then
    return;
  end if;

  insert into public.player_progression(user_id)
  values(p_user_id)
  on conflict(user_id) do nothing;

  select trs.launch_date
    into v_topicrush_launch_date
  from public.topic_rush_settings trs
  where trs.singleton=true;

  v_topicrush_launch_date:=coalesce(v_topicrush_launch_date,current_date);

  -- ----------------------------------------------------------
  -- Rebuild daily stats for this user.
  -- ----------------------------------------------------------

  delete from public.player_daily_stats
  where user_id = p_user_id;

  insert into public.player_daily_stats(
    user_id,
    stat_date,
    games_played,
    questions_answered,
    daily_games_completed,
    full_daily,
    brainmix_points,
    flagdash_points,
    maphunt_points,
    topicrush_points,
    brainiword_points,
    daily_brain_score,
    xp_earned,
    updated_at
  )
  with base as (
    select
      gs.user_id,
      (gs.completed_at at time zone 'UTC')::date as stat_date,
      gs.game_id,
      gr.id as result_id,
      coalesce(gr.score,0) as score,
      coalesce(
        gr.verified_correct_answers,
        gr.correct_answers,
        0
      ) as correct_answers,
      coalesce(
        gr.verified_total_questions,
        gr.total_questions,
        0
      ) as total_questions,
      gr.result_payload,
      public.brainilab_daily_game_points(
        gs.game_id,
        gr.score,
        coalesce(
          gr.verified_correct_answers,
          gr.correct_answers
        ),
        gr.result_payload
      ) as daily_points
    from public.game_sessions gs
    join public.game_results gr
      on gr.session_id = gs.id
    where gs.user_id = p_user_id
      and gs.status = 'completed'
  ),
  daily as (
    select
      user_id,
      stat_date,
      count(*)::integer as games_played,
      coalesce(sum(total_questions),0)::integer as questions_answered,

      (
        count(distinct game_id) filter(
          where game_id in ('brainmix','flagdash','brainiword')
        )
        +
        case
          when stat_date>=v_topicrush_launch_date then
            case
              when bool_or(game_id='topicrush') or bool_or(game_id='maphunt')
                then 1
              else 0
            end
          else
            case when bool_or(game_id='maphunt') then 1 else 0 end
        end
      )::integer as daily_games_completed,

      coalesce(max(daily_points) filter(where game_id='brainmix'),0)::integer
        as brainmix_points,

      coalesce(max(daily_points) filter(where game_id='flagdash'),0)::integer
        as flagdash_points,

      coalesce(max(daily_points) filter(where game_id='maphunt'),0)::integer
        as maphunt_points,

      coalesce(max(daily_points) filter(where game_id='topicrush'),0)::integer
        as topicrush_points,

      coalesce(max(daily_points) filter(where game_id='brainiword'),0)::integer
        as brainiword_points,

      coalesce(sum(50 + least(correct_answers,50) * 5),0)::integer
        as base_xp
    from base
    group by user_id,stat_date
  )
  select
    user_id,
    stat_date,
    games_played,
    questions_answered,
    daily_games_completed,
    daily_games_completed = 4,

    brainmix_points,
    flagdash_points,
    maphunt_points,
    topicrush_points,
    brainiword_points,

    brainmix_points
      + flagdash_points
      + brainiword_points
      + case
          when stat_date>=v_topicrush_launch_date
            then greatest(topicrush_points,maphunt_points)
          else maphunt_points
        end,

    base_xp + case when daily_games_completed=4 then 250 else 0 end,
    now()
  from daily;


  -- ----------------------------------------------------------
  -- Rebuild generic week/month aggregates.
  -- ----------------------------------------------------------

  delete from public.player_period_stats
  where user_id = p_user_id;

  insert into public.player_period_stats(
    user_id,
    period_type,
    period_start,
    games_played,
    questions_answered,
    daily_brain_score,
    full_daily_count,
    active_days,
    xp_earned,
    updated_at
  )
  select
    p_user_id,
    periods.period_type,
    periods.period_start,
    sum(ds.games_played)::integer,
    sum(ds.questions_answered)::bigint,
    sum(ds.daily_brain_score)::integer,
    count(*) filter(where ds.full_daily)::integer,
    count(*) filter(where ds.daily_games_completed > 0)::integer,
    sum(ds.xp_earned)::bigint,
    now()
  from public.player_daily_stats ds
  cross join lateral (
    values
      (
        'week'::text,
        date_trunc('week',ds.stat_date::timestamp)::date
      ),
      (
        'month'::text,
        date_trunc('month',ds.stat_date::timestamp)::date
      )
  ) as periods(period_type,period_start)
  where ds.user_id = p_user_id
  group by periods.period_type,periods.period_start;


  -- ----------------------------------------------------------
  -- Rebuild per-game day/week/month aggregates.
  -- ----------------------------------------------------------

  delete from public.player_game_period_stats
  where user_id = p_user_id;

  insert into public.player_game_period_stats(
    user_id,
    game_id,
    period_type,
    period_start,
    games_played,
    total_score,
    best_score,
    total_correct,
    total_questions,
    average_accuracy,
    best_daily_points,
    metric_name,
    best_metric_value,
    updated_at
  )
  with base as (
    select
      gs.user_id,
      gs.game_id,
      (gs.completed_at at time zone 'UTC')::date as stat_date,
      gr.score,
      coalesce(
        gr.verified_correct_answers,
        gr.correct_answers,
        0
      ) as correct_answers,
      coalesce(
        gr.verified_total_questions,
        gr.total_questions,
        0
      ) as total_questions,
      gr.accuracy,
      gr.result_payload,

      public.brainilab_daily_game_points(
        gs.game_id,
        gr.score,
        coalesce(
          gr.verified_correct_answers,
          gr.correct_answers
        ),
        gr.result_payload
      ) as daily_points,

      case
        when gs.game_id='brainiword'
          and lower(coalesce(gr.result_payload ->> 'won','false'))='true'
          then nullif(gr.result_payload ->> 'attempts','')::numeric
        when gs.game_id='flagdash'
          then coalesce(
            gr.verified_correct_answers,
            gr.correct_answers
          )::numeric
        else gr.score::numeric
      end as metric_value
    from public.game_sessions gs
    join public.game_results gr
      on gr.session_id=gs.id
    where gs.user_id=p_user_id
      and gs.status='completed'
  ),
  expanded as (
    select
      b.*,
      periods.period_type,
      periods.period_start
    from base b
    cross join lateral (
      values
        ('day'::text,b.stat_date),
        (
          'week'::text,
          date_trunc('week',b.stat_date::timestamp)::date
        ),
        (
          'month'::text,
          date_trunc('month',b.stat_date::timestamp)::date
        )
    ) as periods(period_type,period_start)
  )
  select
    p_user_id,
    game_id,
    period_type,
    period_start,

    count(*)::integer,
    coalesce(sum(score),0)::bigint,
    max(score),
    coalesce(sum(correct_answers),0)::integer,
    coalesce(sum(total_questions),0)::integer,
    round(avg(accuracy)::numeric,2),
    coalesce(max(daily_points),0)::integer,

    case
      when game_id='brainiword' then 'attempts'
      when game_id='flagdash' then 'correct'
      else 'score'
    end,

    case
      when game_id='brainiword' then min(metric_value)
      else max(metric_value)
    end,

    now()
  from expanded
  group by
    game_id,
    period_type,
    period_start;


  -- ----------------------------------------------------------
  -- Rebuild personal bests.
  -- ----------------------------------------------------------

  delete from public.player_personal_bests
  where user_id = p_user_id;

  insert into public.player_personal_bests(
    user_id,
    game_id,
    result_id,
    metric_name,
    metric_value,
    score,
    correct_answers,
    total_questions,
    accuracy,
    duration_ms,
    result_payload,
    achieved_at,
    updated_at
  )
  with ranked as (
    select
      gs.game_id,
      gr.id as result_id,
      gr.score,
      coalesce(
        gr.verified_correct_answers,
        gr.correct_answers
      ) as correct_answers,
      coalesce(
        gr.verified_total_questions,
        gr.total_questions
      ) as total_questions,
      gr.accuracy,
      gr.duration_ms,
      gr.result_payload,
      gs.completed_at,

      case
        when gs.game_id='brainiword'
          then 'attempts'
        when gs.game_id='flagdash'
          then 'correct'
        else 'score'
      end as metric_name,

      case
        when gs.game_id='brainiword'
          and lower(coalesce(gr.result_payload ->> 'won','false'))='true'
          then nullif(gr.result_payload ->> 'attempts','')::numeric
        when gs.game_id='flagdash'
          then coalesce(
            gr.verified_correct_answers,
            gr.correct_answers
          )::numeric
        else gr.score::numeric
      end as metric_value,

      row_number() over(
        partition by gs.game_id
        order by
          case
            when gs.game_id='brainiword'
              then case
                when lower(coalesce(gr.result_payload ->> 'won','false'))='true'
                  then 0
                else 1
              end
            else 0
          end asc,

          case
            when gs.game_id='brainiword'
              and lower(coalesce(gr.result_payload ->> 'won','false'))='true'
              then nullif(gr.result_payload ->> 'attempts','')::numeric
            else null
          end asc nulls last,

          case
            when gs.game_id='flagdash'
              then coalesce(
                gr.verified_correct_answers,
                gr.correct_answers
              )::numeric
            when gs.game_id<>'brainiword'
              then gr.score::numeric
            else null
          end desc nulls last,

          gr.accuracy desc nulls last,
          gr.duration_ms asc nulls last,
          gs.completed_at asc
      ) as rn
    from public.game_sessions gs
    join public.game_results gr
      on gr.session_id=gs.id
    where gs.user_id=p_user_id
      and gs.status='completed'
  )
  select
    p_user_id,
    game_id,
    result_id,
    metric_name,
    coalesce(metric_value,0),
    score,
    correct_answers,
    total_questions,
    accuracy,
    duration_ms,
    result_payload,
    completed_at,
    now()
  from ranked
  where rn=1
    and metric_value is not null;


  -- ----------------------------------------------------------
  -- Progression totals.
  -- ----------------------------------------------------------

  select
    count(*)::integer,
    coalesce(sum(
      coalesce(
        gr.verified_total_questions,
        gr.total_questions,
        0
      )
    ),0)::bigint,
    max(gs.completed_at)
  into
    v_total_games,
    v_total_questions,
    v_last_active_at
  from public.game_sessions gs
  join public.game_results gr
    on gr.session_id=gs.id
  where gs.user_id=p_user_id
    and gs.status='completed';

  select count(*)::integer
    into v_full_daily_count
  from public.player_daily_stats
  where user_id=p_user_id
    and full_daily=true;

  select coalesce(sum(xp_earned),0)::bigint
    into v_xp
  from public.player_daily_stats
  where user_id=p_user_id;

  v_level := greatest(
    1,
    floor(sqrt(v_xp::numeric / 20.0))::integer + 1
  );

  select gs.game_id
    into v_favorite_game
  from public.game_sessions gs
  where gs.user_id=p_user_id
    and gs.status='completed'
  group by gs.game_id
  order by count(*) desc,gs.game_id
  limit 1;


  -- ----------------------------------------------------------
  -- Streaks: at least one Daily Game on a UTC date.
  -- ----------------------------------------------------------

  for v_day in
    select stat_date
    from public.player_daily_stats
    where user_id=p_user_id
      and daily_games_completed > 0
    order by stat_date
  loop
    if v_previous_date is null
       or v_day.stat_date = v_previous_date + 1 then
      v_run := v_run + 1;
    else
      v_run := 1;
    end if;

    v_best_streak := greatest(v_best_streak,v_run);
    v_previous_date := v_day.stat_date;
    v_last_streak_date := v_day.stat_date;
  end loop;

  if v_last_streak_date is not null
     and v_last_streak_date >= v_today - 1 then

    v_current_streak := 0;
    v_previous_date := null;

    for v_day in
      select stat_date
      from public.player_daily_stats
      where user_id=p_user_id
        and daily_games_completed > 0
        and stat_date <= v_last_streak_date
      order by stat_date desc
    loop
      if v_previous_date is null
         or v_day.stat_date = v_previous_date - 1 then
        v_current_streak := v_current_streak + 1;
        v_previous_date := v_day.stat_date;
      else
        exit;
      end if;
    end loop;
  else
    v_current_streak := 0;
  end if;

  update public.player_progression
  set
    current_streak=v_current_streak,
    best_streak=v_best_streak,
    full_daily_count=v_full_daily_count,
    xp=v_xp,
    level=v_level,
    total_games=v_total_games,
    total_questions=v_total_questions,
    favorite_game_id=v_favorite_game,
    last_streak_date=v_last_streak_date,
    last_active_at=v_last_active_at,
    updated_at=now()
  where user_id=p_user_id;
end;
$$;

create or replace function public.get_my_brainilab_progression()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_today date := (now() at time zone 'UTC')::date;
  v_week date := date_trunc(
    'week',
    (now() at time zone 'UTC')
  )::date;
  v_month date := date_trunc(
    'month',
    (now() at time zone 'UTC')
  )::date;

  v_daily_number integer;
  v_progression jsonb;
  v_today_stats jsonb;
  v_week_stats jsonb;
  v_month_stats jsonb;
  v_personal_bests jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select dc.daily_number
    into v_daily_number
  from public.daily_challenges dc
  where dc.challenge_date=v_today
  order by dc.generation_version desc
  limit 1;

  select to_jsonb(pp)
    into v_progression
  from public.player_progression pp
  where pp.user_id=v_user_id;

  select jsonb_build_object(
    'stat_date',v_today,
    'daily_number',v_daily_number,
    'games_played',coalesce(ds.games_played,0),
    'questions_answered',coalesce(ds.questions_answered,0),
    'daily_games_completed',coalesce(ds.daily_games_completed,0),
    'full_daily',coalesce(ds.full_daily,false),
    'brainmix_points',coalesce(ds.brainmix_points,0),
    'flagdash_points',coalesce(ds.flagdash_points,0),
    'maphunt_points',coalesce(ds.maphunt_points,0),
    'topicrush_points',greatest(
      coalesce(ds.topicrush_points,0),
      coalesce(ds.maphunt_points,0)
    ),
    'brainiword_points',coalesce(ds.brainiword_points,0),

    'brainmix_played',exists(
      select 1
      from public.player_game_period_stats gps
      where gps.user_id=v_user_id
        and gps.game_id='brainmix'
        and gps.period_type='day'
        and gps.period_start=v_today
    ),
    'flagdash_played',exists(
      select 1
      from public.player_game_period_stats gps
      where gps.user_id=v_user_id
        and gps.game_id='flagdash'
        and gps.period_type='day'
        and gps.period_start=v_today
    ),
    'maphunt_played',exists(
      select 1
      from public.player_game_period_stats gps
      where gps.user_id=v_user_id
        and gps.game_id='maphunt'
        and gps.period_type='day'
        and gps.period_start=v_today
    ),
    'topicrush_played',exists(
      select 1
      from public.player_game_period_stats gps
      where gps.user_id=v_user_id
        and gps.game_id in ('topicrush','maphunt')
        and gps.period_type='day'
        and gps.period_start=v_today
    ),
    'brainiword_played',exists(
      select 1
      from public.player_game_period_stats gps
      where gps.user_id=v_user_id
        and gps.game_id='brainiword'
        and gps.period_type='day'
        and gps.period_start=v_today
    ),

    'daily_brain_score',coalesce(ds.daily_brain_score,0),
    'xp_earned',coalesce(ds.xp_earned,0)
  )
  into v_today_stats
  from (select 1) seed
  left join public.player_daily_stats ds
    on ds.user_id=v_user_id
   and ds.stat_date=v_today;

  select coalesce(
    to_jsonb(ps),
    jsonb_build_object(
      'period_type','week',
      'period_start',v_week,
      'games_played',0,
      'questions_answered',0,
      'daily_brain_score',0,
      'full_daily_count',0,
      'active_days',0,
      'xp_earned',0
    )
  )
  into v_week_stats
  from (select 1) seed
  left join public.player_period_stats ps
    on ps.user_id=v_user_id
   and ps.period_type='week'
   and ps.period_start=v_week;

  select coalesce(
    to_jsonb(ps),
    jsonb_build_object(
      'period_type','month',
      'period_start',v_month,
      'games_played',0,
      'questions_answered',0,
      'daily_brain_score',0,
      'full_daily_count',0,
      'active_days',0,
      'xp_earned',0
    )
  )
  into v_month_stats
  from (select 1) seed
  left join public.player_period_stats ps
    on ps.user_id=v_user_id
   and ps.period_type='month'
   and ps.period_start=v_month;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'game_id',pb.game_id,
        'result_id',pb.result_id,
        'metric_name',pb.metric_name,
        'metric_value',pb.metric_value,
        'score',pb.score,
        'correct_answers',pb.correct_answers,
        'total_questions',pb.total_questions,
        'accuracy',pb.accuracy,
        'duration_ms',pb.duration_ms,
        'result_payload',pb.result_payload,
        'achieved_at',pb.achieved_at
      )
      order by pb.game_id
    ),
    '[]'::jsonb
  )
  into v_personal_bests
  from public.player_personal_bests pb
  where pb.user_id=v_user_id;

  return jsonb_build_object(
    'progression',coalesce(
      v_progression,
      jsonb_build_object(
        'user_id',v_user_id,
        'current_streak',0,
        'best_streak',0,
        'full_daily_count',0,
        'xp',0,
        'level',1,
        'total_games',0,
        'total_questions',0,
        'favorite_game_id',null
      )
    ),
    'today',v_today_stats,
    'week',v_week_stats,
    'month',v_month_stats,
    'personal_bests',v_personal_bests,
    'generated_at',now()
  );
end;
$$;


-- ============================================================
-- FINAL RANKING HELPERS — Topic Rush is a normalized Daily game
-- ============================================================

create or replace function public.brainilab_player_rank_value(
  p_user_id uuid,
  p_period text,
  p_game_id text,
  p_metric text
)
returns bigint
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_period text:=lower(coalesce(p_period,'daily'));
  v_game text:=lower(coalesce(p_game_id,'all'));
  v_metric text:=lower(coalesce(p_metric,'score'));

  v_today date:=(now() at time zone 'UTC')::date;
  v_week date:=date_trunc(
    'week',
    (now() at time zone 'UTC')
  )::date;
  v_month date:=date_trunc(
    'month',
    (now() at time zone 'UTC')
  )::date;

  v_value bigint:=0;
  v_period_type text;
  v_period_start date;
begin
  if p_user_id is null then
    return 0;
  end if;

  if v_metric='streak' then
    select coalesce(pp.current_streak,0)::bigint
      into v_value
    from public.player_progression pp
    where pp.user_id=p_user_id;

    return coalesce(v_value,0);
  end if;

  if v_period not in ('daily','weekly','monthly') then
    return 0;
  end if;

  -- All games: Daily Brain Score.
  if v_game='all' then
    if v_period='daily' then
      select coalesce(ds.daily_brain_score,0)::bigint
        into v_value
      from public.player_daily_stats ds
      where ds.user_id=p_user_id
        and ds.stat_date=v_today;
    elsif v_period='weekly' then
      select coalesce(ps.daily_brain_score,0)::bigint
        into v_value
      from public.player_period_stats ps
      where ps.user_id=p_user_id
        and ps.period_type='week'
        and ps.period_start=v_week;
    else
      select coalesce(ps.daily_brain_score,0)::bigint
        into v_value
      from public.player_period_stats ps
      where ps.user_id=p_user_id
        and ps.period_type='month'
        and ps.period_start=v_month;
    end if;

    return coalesce(v_value,0);
  end if;

  -- Daily games use normalized Daily Brain Score contribution points.
  if v_game in ('brainmix','flagdash','maphunt','topicrush','brainiword') then
    select coalesce(
      sum(
        case v_game
          when 'brainmix' then ds.brainmix_points
          when 'flagdash' then ds.flagdash_points
          when 'maphunt' then ds.maphunt_points
          when 'topicrush' then case
            when ds.stat_date >= (
              select trs.launch_date
              from public.topic_rush_settings trs
              where trs.singleton=true
            )
              then greatest(ds.topicrush_points,ds.maphunt_points)
            else 0
          end
          when 'brainiword' then ds.brainiword_points
          else 0
        end
      ),
      0
    )::bigint
    into v_value
    from public.player_daily_stats ds
    where ds.user_id=p_user_id
      and (
        (v_period='daily' and ds.stat_date=v_today)
        or
        (
          v_period='weekly'
          and ds.stat_date between v_week and v_today
        )
        or
        (
          v_period='monthly'
          and ds.stat_date between v_month and v_today
        )
      );

    return coalesce(v_value,0);
  end if;

  -- Evergreen game score.
  if v_period='daily' then
    v_period_type:='day';
    v_period_start:=v_today;
  elsif v_period='weekly' then
    v_period_type:='week';
    v_period_start:=v_week;
  else
    v_period_type:='month';
    v_period_start:=v_month;
  end if;

  select coalesce(gps.total_score,0)::bigint
    into v_value
  from public.player_game_period_stats gps
  where gps.user_id=p_user_id
    and gps.game_id=v_game
    and gps.period_type=v_period_type
    and gps.period_start=v_period_start;

  return coalesce(v_value,0);
end;
$$;

create or replace function public.get_my_brainilab_friends_ranking(
  p_period text default 'daily',
  p_game_id text default 'all',
  p_metric text default 'score'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();
  v_period text:=lower(coalesce(p_period,'daily'));
  v_game text:=lower(coalesce(p_game_id,'all'));
  v_metric text:=lower(coalesce(p_metric,'score'));

  v_rows jsonb;
  v_me_row jsonb;
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

  if v_period not in ('daily','weekly','monthly') then
    raise exception 'Invalid ranking period';
  end if;

  if v_metric not in ('score','streak') then
    raise exception 'Invalid ranking metric';
  end if;

  with members as (
    select v_me as user_id

    union

    select
      case
        when f.user_a=v_me then f.user_b
        else f.user_a
      end
    from public.friendships f
    where f.user_a=v_me or f.user_b=v_me
  ),
  values_by_member as (
    select
      m.user_id,
      p.display_name,
      p.country_code,
      p.avatar_url,

      coalesce(pp.current_streak,0) as streak,

      public.brainilab_player_rank_value(
        m.user_id,
        v_period,
        v_game,
        v_metric
      ) as rank_value

    from members m

    join public.profiles p
      on p.user_id=m.user_id

    left join public.player_progression pp
      on pp.user_id=m.user_id
  ),
  ranked as (
    select
      v.*,
      row_number() over(
        order by
          v.rank_value desc,
          lower(v.display_name),
          v.user_id
      ) as rank
    from values_by_member v
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'rank',r.rank,
          'user_id',r.user_id,
          'name',r.display_name,
          'country',r.country_code,
          'avatar_url',r.avatar_url,
          'avatar',upper(left(r.display_name,1)),
          'score',r.rank_value,
          'streak',r.streak,
          'display_value',case
            when v_metric='streak'
              then r.rank_value::text || ' days'
            else to_char(
              r.rank_value,
              'FM999G999G999G990'
            )
          end,
          'is_me',r.user_id=v_me
        )
        order by r.rank
      ),
      '[]'::jsonb
    ),

    (
      select jsonb_build_object(
        'rank',mine.rank,
        'user_id',mine.user_id,
        'name',mine.display_name,
        'country',mine.country_code,
        'avatar_url',mine.avatar_url,
        'avatar',upper(left(mine.display_name,1)),
        'score',mine.rank_value,
        'streak',mine.streak,
        'display_value',case
          when v_metric='streak'
            then mine.rank_value::text || ' days'
          else to_char(
            mine.rank_value,
            'FM999G999G999G990'
          )
        end,
        'is_me',true
      )
      from ranked mine
      where mine.user_id=v_me
    )

  into v_rows,v_me_row
  from ranked r;

  return jsonb_build_object(
    'rows',v_rows,
    'user',v_me_row,

    'metric_label',case
      when v_metric='streak' then 'Streak'
      when v_game='all' then 'Brain Score'
      when v_game in (
        'brainmix','flagdash','maphunt','topicrush','brainiword'
      ) then 'Daily points'
      else 'Points'
    end,

    'total_players',jsonb_array_length(v_rows),
    'period',v_period,
    'game_id',v_game,
    'generated_at',now()
  );
end;
$$;

create or replace function public.get_brainilab_individual_rankings(
  p_region text default 'global',
  p_country_code text default null,
  p_period text default 'daily',
  p_game_id text default 'all',
  p_metric text default 'score',
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();
  v_region text:=lower(coalesce(p_region,'global'));
  v_country text:=upper(nullif(btrim(coalesce(p_country_code,'')),''));
  v_period text:=lower(coalesce(p_period,'daily'));
  v_game text:=lower(coalesce(p_game_id,'all'));
  v_metric text:=lower(coalesce(p_metric,'score'));
  v_limit integer:=least(100,greatest(10,coalesce(p_limit,100)));
  v_my_country text;
  v_my_enabled boolean:=false;
  v_my_public_name text;
  v_rows jsonb;
  v_user jsonb;
  v_total integer:=0;
  v_user_eligible boolean:=false;
begin
  if v_region not in ('global','country') then
    raise exception 'Invalid ranking region';
  end if;

  if v_period not in ('daily','weekly','monthly') then
    raise exception 'Invalid ranking period';
  end if;

  if v_metric not in ('score','streak') then
    raise exception 'Invalid ranking metric';
  end if;

  if v_me is not null then
    select
      p.country_code,
      p.leaderboard_enabled,
      p.leaderboard_display_name
    into
      v_my_country,
      v_my_enabled,
      v_my_public_name
    from public.profiles p
    where p.user_id=v_me;

    if v_country is null then
      v_country:=v_my_country;
    end if;
  end if;

  if v_region='country'
     and (v_country is null or v_country !~ '^[A-Z]{2}$') then
    return jsonb_build_object(
      'rows','[]'::jsonb,
      'user',null,
      'total_players',0,
      'metric_label',case
        when v_metric='streak' then 'Streak'
        when v_game='all' then 'Brain Score'
        when v_game in ('brainmix','flagdash','maphunt','topicrush','brainiword')
          then 'Daily points'
        else 'Points'
      end,
      'leaderboard_enabled',v_my_enabled,
      'leaderboard_display_name',v_my_public_name,
      'user_eligible',false,
      'country_required',true,
      'my_country',v_my_country,
      'generated_at',now()
    );
  end if;

  with candidates as (
    select
      p.user_id,
      p.leaderboard_display_name as public_name,
      p.country_code,
      public.brainilab_player_rank_value(
        p.user_id,
        v_period,
        v_game,
        v_metric
      ) as rank_value
    from public.profiles p
    where p.leaderboard_enabled=true
      and p.leaderboard_display_name is not null
      and char_length(btrim(p.leaderboard_display_name))>=2
      and (
        v_region='global'
        or p.country_code=v_country
      )
      and not exists(
        select 1
        from public.admin_ranking_suspensions ars
        where ars.entity_type='user'
          and ars.entity_id=p.user_id
          and ars.active=true
          and (
            ars.expires_at is null
            or ars.expires_at>now()
          )
      )
  ),
  eligible as (
    select *
    from candidates
    where rank_value>0
  ),
  ranked as (
    select
      e.*,
      row_number() over(
        order by
          e.rank_value desc,
          lower(e.public_name),
          e.user_id
      ) as rank
    from eligible e
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'rank',r.rank,
          'name',r.public_name,
          'country',r.country_code,
          'avatar',upper(left(r.public_name,1)),
          'score',r.rank_value,
          'streak',case
            when v_metric='streak' then r.rank_value
            else (
              select coalesce(pp.current_streak,0)
              from public.player_progression pp
              where pp.user_id=r.user_id
            )
          end,
          'display_value',case
            when v_metric='streak'
              then r.rank_value::text||' days'
            else to_char(r.rank_value,'FM999G999G999G990')
          end,
          'is_me',r.user_id=v_me
        )
        order by r.rank
      ) filter(where r.rank<=v_limit),
      '[]'::jsonb
    ),
    count(*)::integer,
    (
      select jsonb_build_object(
        'rank',mine.rank,
        'name',mine.public_name,
        'country',mine.country_code,
        'avatar',upper(left(mine.public_name,1)),
        'score',mine.rank_value,
        'streak',case
          when v_metric='streak' then mine.rank_value
          else (
            select coalesce(pp.current_streak,0)
            from public.player_progression pp
            where pp.user_id=mine.user_id
          )
        end,
        'display_value',case
          when v_metric='streak'
            then mine.rank_value::text||' days'
          else to_char(mine.rank_value,'FM999G999G999G990')
        end,
        'is_me',true
      )
      from ranked mine
      where mine.user_id=v_me
      limit 1
    ),
    exists(
      select 1 from ranked mine
      where mine.user_id=v_me
    )
  into
    v_rows,
    v_total,
    v_user,
    v_user_eligible
  from ranked r;

  return jsonb_build_object(
    'rows',v_rows,
    'user',v_user,
    'total_players',v_total,
    'metric_label',case
      when v_metric='streak' then 'Streak'
      when v_game='all' then 'Brain Score'
      when v_game in ('brainmix','flagdash','maphunt','topicrush','brainiword')
        then 'Daily points'
      else 'Points'
    end,
    'leaderboard_enabled',v_my_enabled,
    'leaderboard_display_name',v_my_public_name,
    'user_eligible',v_user_eligible,
    'region',v_region,
    'country',v_country,
    'my_country',v_my_country,
    'period',v_period,
    'game_id',v_game,
    'generated_at',now()
  );
end;
$$;

create or replace function public.refresh_brainilab_group_game_rank_stats(
  p_group_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if p_group_id is null then
    return;
  end if;

  delete from public.group_game_period_stats
  where group_id=p_group_id;

  -- ----------------------------------------------------------
  -- Daily Games: normalized Daily contribution points.
  -- ----------------------------------------------------------

  insert into public.group_game_period_stats(
    group_id,
    game_id,
    period_type,
    period_start,
    member_count,
    active_members,
    group_score,
    eligible,
    top_contributors,
    updated_at
  )
  with members as (
    select gm.user_id
    from public.group_members gm
    where gm.group_id=p_group_id
  ),
  daily_values as (
    select
      ds.user_id,
      games.game_id,
      periods.period_type,
      periods.period_start,

      sum(
        case games.game_id
          when 'brainmix' then ds.brainmix_points
          when 'flagdash' then ds.flagdash_points
          when 'maphunt' then ds.maphunt_points
          when 'topicrush' then case
            when ds.stat_date >= (
              select trs.launch_date
              from public.topic_rush_settings trs
              where trs.singleton=true
            )
              then greatest(ds.topicrush_points,ds.maphunt_points)
            else 0
          end
          when 'brainiword' then ds.brainiword_points
          else 0
        end
      )::bigint as score

    from public.player_daily_stats ds

    join members m
      on m.user_id=ds.user_id

    cross join (
      values
        ('brainmix'::text),
        ('flagdash'::text),
        ('maphunt'::text),
        ('topicrush'::text),
        ('brainiword'::text)
    ) games(game_id)

    cross join lateral (
      values
        ('day'::text,ds.stat_date),
        (
          'week'::text,
          date_trunc(
            'week',
            ds.stat_date::timestamp
          )::date
        ),
        (
          'month'::text,
          date_trunc(
            'month',
            ds.stat_date::timestamp
          )::date
        )
    ) periods(period_type,period_start)

    group by
      ds.user_id,
      games.game_id,
      periods.period_type,
      periods.period_start
  ),
  period_keys as (
    select distinct
      dv.game_id,
      dv.period_type,
      dv.period_start
    from daily_values dv
  ),
  ranked as (
    select
      pk.game_id,
      pk.period_type,
      pk.period_start,
      m.user_id,
      p.display_name,
      coalesce(dv.score,0)::bigint as score,

      row_number() over(
        partition by
          pk.game_id,
          pk.period_type,
          pk.period_start
        order by
          coalesce(dv.score,0) desc,
          m.user_id
      ) as rn,

      count(*) over(
        partition by
          pk.game_id,
          pk.period_type,
          pk.period_start
      )::integer as member_count,

      count(*) filter(
        where coalesce(dv.score,0)>0
      ) over(
        partition by
          pk.game_id,
          pk.period_type,
          pk.period_start
      )::integer as active_members

    from period_keys pk
    cross join members m

    join public.profiles p
      on p.user_id=m.user_id

    left join daily_values dv
      on dv.user_id=m.user_id
     and dv.game_id=pk.game_id
     and dv.period_type=pk.period_type
     and dv.period_start=pk.period_start
  )
  select
    p_group_id,
    r.game_id,
    r.period_type,
    r.period_start,
    max(r.member_count),
    max(r.active_members),

    coalesce(
      sum(r.score) filter(where r.rn<=3),
      0
    )::bigint,

    max(r.member_count)>=3,

    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'user_id',r.user_id,
          'name',r.display_name,
          'score',r.score
        )
        order by r.rn
      ) filter(where r.rn<=3),
      '[]'::jsonb
    ),

    now()

  from ranked r

  group by
    r.game_id,
    r.period_type,
    r.period_start;


  -- ----------------------------------------------------------
  -- Evergreen games: accumulated raw score.
  -- ----------------------------------------------------------

  insert into public.group_game_period_stats(
    group_id,
    game_id,
    period_type,
    period_start,
    member_count,
    active_members,
    group_score,
    eligible,
    top_contributors,
    updated_at
  )
  with members as (
    select gm.user_id
    from public.group_members gm
    where gm.group_id=p_group_id
  ),
  period_keys as (
    select distinct
      gps.game_id,
      gps.period_type,
      gps.period_start
    from public.player_game_period_stats gps
    join members m
      on m.user_id=gps.user_id
    where gps.game_id not in (
      'brainmix','flagdash','maphunt','topicrush','brainiword'
    )
  ),
  ranked as (
    select
      pk.game_id,
      pk.period_type,
      pk.period_start,
      m.user_id,
      p.display_name,
      coalesce(gps.total_score,0)::bigint as score,

      row_number() over(
        partition by
          pk.game_id,
          pk.period_type,
          pk.period_start
        order by
          coalesce(gps.total_score,0) desc,
          m.user_id
      ) as rn,

      count(*) over(
        partition by
          pk.game_id,
          pk.period_type,
          pk.period_start
      )::integer as member_count,

      count(*) filter(
        where coalesce(gps.games_played,0)>0
      ) over(
        partition by
          pk.game_id,
          pk.period_type,
          pk.period_start
      )::integer as active_members

    from period_keys pk
    cross join members m

    join public.profiles p
      on p.user_id=m.user_id

    left join public.player_game_period_stats gps
      on gps.user_id=m.user_id
     and gps.game_id=pk.game_id
     and gps.period_type=pk.period_type
     and gps.period_start=pk.period_start
  )
  select
    p_group_id,
    r.game_id,
    r.period_type,
    r.period_start,
    max(r.member_count),
    max(r.active_members),

    coalesce(
      sum(r.score) filter(where r.rn<=3),
      0
    )::bigint,

    max(r.member_count)>=3,

    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'user_id',r.user_id,
          'name',r.display_name,
          'score',r.score
        )
        order by r.rn
      ) filter(where r.rn<=3),
      '[]'::jsonb
    ),

    now()

  from ranked r

  group by
    r.game_id,
    r.period_type,
    r.period_start;
end;
$$;

create or replace function public.get_brainilab_group_rankings(
  p_region text default 'global',
  p_country_code text default null,
  p_period text default 'daily',
  p_game_id text default 'all',
  p_metric text default 'score',
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();

  v_region text:=lower(coalesce(p_region,'global'));
  v_country text:=upper(
    nullif(btrim(coalesce(p_country_code,'')),'')
  );
  v_period text:=lower(coalesce(p_period,'daily'));
  v_game text:=lower(coalesce(p_game_id,'all'));
  v_metric text:=lower(coalesce(p_metric,'score'));

  v_today date:=(now() at time zone 'UTC')::date;
  v_week date:=date_trunc(
    'week',
    (now() at time zone 'UTC')
  )::date;
  v_month date:=date_trunc(
    'month',
    (now() at time zone 'UTC')
  )::date;

  v_period_type text;
  v_period_start date;

  v_limit integer:=least(
    100,
    greatest(10,coalesce(p_limit,100))
  );

  v_rows jsonb;
  v_user jsonb;
  v_my_groups jsonb;
  v_total integer;
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

  if v_region not in ('global','country') then
    raise exception 'Invalid group ranking region';
  end if;

  if v_period not in ('daily','weekly','monthly') then
    raise exception 'Invalid group ranking period';
  end if;

  if v_metric not in ('score','streak') then
    raise exception 'Invalid group ranking metric';
  end if;

  if v_region='country'
     and (v_country is null or v_country !~ '^[A-Z]{2}$') then

    return jsonb_build_object(
      'rows','[]'::jsonb,
      'user',null,
      'my_groups','[]'::jsonb,
      'total_players',0,
      'metric_label',case
        when v_metric='streak' then 'Group streak'
        when v_game='all' then 'Group Brain Score'
        when v_game in (
          'brainmix','flagdash','maphunt','topicrush','brainiword'
        ) then 'Group Daily points'
        else 'Group points'
      end,
      'country_required',true
    );
  end if;

  if v_period='daily' then
    v_period_type:='day';
    v_period_start:=v_today;
  elsif v_period='weekly' then
    v_period_type:='week';
    v_period_start:=v_week;
  else
    v_period_type:='month';
    v_period_start:=v_month;
  end if;

  with group_base as (
    select
      g.id,
      g.name,
      g.country_code,
      g.crest_icon,
      g.crest_color,

      (
        select count(*)::integer
        from public.group_members gm
        where gm.group_id=g.id
      ) as member_count,

      exists(
        select 1
        from public.group_members mine
        where mine.group_id=g.id
          and mine.user_id=v_me
      ) as is_mine

    from public.groups g

    where g.status='active'
      and (
        v_region='global'
        or g.country_code=v_country
      )
      and not exists(
        select 1
        from public.admin_ranking_suspensions ars
        where ars.entity_type='group'
          and ars.entity_id=g.id
          and ars.active=true
          and (
            ars.expires_at is null
            or ars.expires_at>now()
          )
      )
  ),
  scored as (
    select
      gb.*,

      case
        when v_metric='streak'
          then public.brainilab_group_current_streak(
            gb.id
          )::bigint

        when v_game='all'
             and v_period='daily'
          then coalesce(gds.group_score,0)

        when v_game='all'
             and v_period in ('weekly','monthly')
          then coalesce(gps.group_score,0)

        else coalesce(ggps.group_score,0)
      end as score

    from group_base gb

    left join public.group_daily_stats gds
      on gds.group_id=gb.id
     and gds.stat_date=v_today

    left join public.group_period_stats gps
      on gps.group_id=gb.id
     and gps.period_type=case
       when v_period='weekly' then 'week'
       else 'month'
     end
     and gps.period_start=case
       when v_period='weekly' then v_week
       else v_month
     end

    left join public.group_game_period_stats ggps
      on ggps.group_id=gb.id
     and ggps.game_id=v_game
     and ggps.period_type=v_period_type
     and ggps.period_start=v_period_start

    where gb.member_count>=3
  ),
  eligible as (
    select *
    from scored
    where score>0
  ),
  ranked as (
    select
      s.*,
      row_number() over(
        order by
          s.score desc,
          lower(s.name),
          s.id
      ) as rank
    from eligible s
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'rank',r.rank,
          'group_id',r.id,
          'name',r.name,
          'country',r.country_code,

          'crest',jsonb_build_object(
            'icon',r.crest_icon,
            'color',r.crest_color
          ),

          'members',r.member_count,
          'score',r.score,

          'streak',case
            when v_metric='streak' then r.score
            else public.brainilab_group_current_streak(
              r.id
            )
          end,

          'display_value',case
            when v_metric='streak'
              then r.score::text || ' days'
            else to_char(
              r.score,
              'FM999G999G999G990'
            )
          end,

          'is_me',r.is_mine
        )
        order by r.rank
      ) filter(where r.rank<=v_limit),
      '[]'::jsonb
    ),

    count(*)::integer,

    (
      select jsonb_build_object(
        'rank',mine.rank,
        'group_id',mine.id,
        'name',mine.name,
        'country',mine.country_code,

        'crest',jsonb_build_object(
          'icon',mine.crest_icon,
          'color',mine.crest_color
        ),

        'members',mine.member_count,
        'score',mine.score,

        'streak',case
          when v_metric='streak' then mine.score
          else public.brainilab_group_current_streak(
            mine.id
          )
        end,

        'display_value',case
          when v_metric='streak'
            then mine.score::text || ' days'
          else to_char(
            mine.score,
            'FM999G999G999G990'
          )
        end,

        'is_me',true
      )
      from ranked mine
      where mine.is_mine=true
      order by mine.rank
      limit 1
    )

  into v_rows,v_total,v_user
  from ranked r;


  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'group_id',g.id,
        'name',g.name,
        'country',g.country_code,

        'crest',jsonb_build_object(
          'icon',g.crest_icon,
          'color',g.crest_color
        ),

        'members',(
          select count(*)
          from public.group_members cgm
          where cgm.group_id=g.id
        ),

        'eligible',(
          select count(*)>=3
          from public.group_members cgm
          where cgm.group_id=g.id
        )
      )
      order by g.created_at desc
    ),
    '[]'::jsonb
  )
  into v_my_groups
  from public.group_members gm
  join public.groups g
    on g.id=gm.group_id
   and g.status='active'
  where gm.user_id=v_me;


  return jsonb_build_object(
    'rows',v_rows,
    'user',v_user,
    'my_groups',v_my_groups,
    'total_players',v_total,

    'metric_label',case
      when v_metric='streak' then 'Group streak'
      when v_game='all' then 'Group Brain Score'
      when v_game in (
        'brainmix','flagdash','maphunt','topicrush','brainiword'
      ) then 'Group Daily points'
      else 'Group points'
    end,

    'period',v_period,
    'game_id',v_game,
    'region',v_region,
    'country',v_country,
    'generated_at',now()
  );
end;
$$;


-- ============================================================
-- RUNTIME FLAGS — retire Map Hunt, add Topic Rush
-- ============================================================

alter table public.runtime_flags
  drop constraint if exists runtime_flags_key_check;

alter table public.runtime_flags
  add constraint runtime_flags_key_check
  check(flag_key in (
    'brainmix_enabled',
    'flagdash_enabled',
    'maphunt_enabled',
    'topicrush_enabled',
    'brainiword_enabled',
    'rankings_enabled',
    'groups_enabled',
    'maintenance_enabled'
  ));

insert into public.runtime_flags(flag_key,enabled,message)
values('topicrush_enabled',true,null)
on conflict(flag_key) do nothing;

delete from public.runtime_flags
where flag_key='maphunt_enabled';

-- The legacy key is removed from the allowed runtime surface after its row is deleted.
alter table public.runtime_flags
  drop constraint if exists runtime_flags_key_check;

alter table public.runtime_flags
  add constraint runtime_flags_key_check
  check(flag_key in (
    'brainmix_enabled',
    'flagdash_enabled',
    'topicrush_enabled',
    'brainiword_enabled',
    'rankings_enabled',
    'groups_enabled',
    'maintenance_enabled'
  ));

create or replace function public.admin_set_brainilab_runtime_flag(
  p_flag_key text,
  p_enabled boolean,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid;
begin
  v_uid:=public.require_brainilab_admin(
    array['owner']::text[]
  );

  if p_flag_key not in (
    'brainmix_enabled','flagdash_enabled','topicrush_enabled',
    'brainiword_enabled','rankings_enabled','groups_enabled',
    'maintenance_enabled'
  ) then
    raise exception 'Invalid runtime flag';
  end if;

  update public.runtime_flags
  set
    enabled=p_enabled,
    message=nullif(left(btrim(coalesce(p_message,'')),500),''),
    updated_by=v_uid,
    updated_at=now()
  where flag_key=p_flag_key;

  perform public.log_brainilab_admin_action(
    'RUNTIME_FLAG_UPDATED',
    'runtime_flag',
    p_flag_key,
    jsonb_build_object(
      'enabled',p_enabled,
      'message',nullif(left(btrim(coalesce(p_message,'')),500),'')
    )
  );

  return (
    select jsonb_build_object(
      'flag_key',rf.flag_key,
      'enabled',rf.enabled,
      'message',rf.message,
      'updated_at',rf.updated_at
    )
    from public.runtime_flags rf
    where rf.flag_key=p_flag_key
  );
end;
$$;


-- ============================================================
-- ADMIN — Topic Rush operations
-- ============================================================

create or replace function public.admin_get_topic_rush_daily(
  p_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_uid uuid;
begin
  v_uid:=public.require_brainilab_admin(
    array['owner','editor']::text[]
  );

  return (
    select jsonb_build_object(
      'exists',true,
      'daily_challenge_id',dc.id,
      'daily_number',dc.daily_number,
      'date',dc.challenge_date,
      'topic_id',trt.id,
      'title',trt.title,
      'prompt',trt.prompt,
      'target_count',trt.target_count,
      'duration_seconds',trs.duration_seconds,
      'answer_count',(
        select count(*)
        from public.topic_rush_answers tra
        where tra.topic_id=trt.id
      ),
      'answers',(
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'answer',tra.answer_text,
              'aliases',tra.normalized_aliases
            )
            order by tra.answer_text
          ),
          '[]'::jsonb
        )
        from public.topic_rush_answers tra
        where tra.topic_id=trt.id
      )
    )
    from public.daily_challenges dc
    join public.daily_topic_rush dtr
      on dtr.daily_challenge_id=dc.id
    join public.topic_rush_topics trt
      on trt.id=dtr.topic_id
    cross join public.topic_rush_settings trs
    where dc.challenge_date=p_date
      and trs.singleton=true
    limit 1
  );
end;
$$;

revoke execute on function public.admin_get_topic_rush_daily(date)
  from public,anon;

grant execute on function public.admin_get_topic_rush_daily(date)
  to authenticated;


create or replace function public.admin_list_topic_rush_topics()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_uid uuid;
begin
  v_uid:=public.require_brainilab_admin(
    array['owner','editor']::text[]
  );

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id',trt.id,
          'external_key',trt.external_key,
          'title',trt.title,
          'prompt',trt.prompt,
          'target_count',trt.target_count,
          'active',trt.is_active,
          'answer_count',(
            select count(*)
            from public.topic_rush_answers tra
            where tra.topic_id=trt.id
          ),
          'last_used',(
            select max(dc.challenge_date)
            from public.daily_topic_rush dtr
            join public.daily_challenges dc
              on dc.id=dtr.daily_challenge_id
            where dtr.topic_id=trt.id
          )
        )
        order by trt.is_active desc,trt.title
      ),
      '[]'::jsonb
    )
    from public.topic_rush_topics trt
  );
end;
$$;

revoke execute on function public.admin_list_topic_rush_topics()
  from public,anon;

grant execute on function public.admin_list_topic_rush_topics()
  to authenticated;


create or replace function public.admin_create_topic_rush_topic(
  p_external_key text,
  p_title text,
  p_prompt text,
  p_target_count integer,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid;
  v_key text:=lower(btrim(coalesce(p_external_key,'')));
  v_title text:=btrim(coalesce(p_title,''));
  v_prompt text:=btrim(coalesce(p_prompt,''));
  v_topic_id uuid;
  v_item jsonb;
  v_answer text;
  v_aliases text[];
  v_count integer:=0;
begin
  v_uid:=public.require_brainilab_admin(
    array['owner','editor']::text[]
  );

  if v_key !~ '^[a-z0-9][a-z0-9-]{2,119}$' then
    raise exception 'External key must be lowercase letters, numbers and hyphens';
  end if;

  if char_length(v_title) not between 3 and 120 then
    raise exception 'Topic title must be 3–120 characters';
  end if;

  if char_length(v_prompt) not between 3 and 300 then
    raise exception 'Topic prompt must be 3–300 characters';
  end if;

  if p_target_count not between 5 and 30 then
    raise exception 'Target count must be 5–30';
  end if;

  if jsonb_typeof(coalesce(p_answers,'[]'::jsonb))<>'array' then
    raise exception 'Answers must be an array';
  end if;

  if jsonb_array_length(p_answers)<20 then
    raise exception 'Topic Rush topics need at least 20 canonical answers';
  end if;

  if p_target_count>jsonb_array_length(p_answers) then
    raise exception 'Target cannot exceed answer count';
  end if;

  if exists(
    select 1
    from public.topic_rush_topics trt
    where trt.external_key=v_key
  ) then
    raise exception 'Topic external key already exists';
  end if;

  insert into public.topic_rush_topics(
    external_key,
    title,
    prompt,
    target_count,
    is_active
  )
  values(
    v_key,
    v_title,
    v_prompt,
    p_target_count,
    true
  )
  returning id into v_topic_id;

  for v_item in
    select value
    from jsonb_array_elements(p_answers)
  loop
    v_answer:=btrim(
      coalesce(
        case
          when jsonb_typeof(v_item)='string' then v_item#>>'{}'
          else v_item->>'answer'
        end,
        ''
      )
    );

    if v_answer='' then
      raise exception 'Every Topic Rush answer needs text';
    end if;

    select coalesce(
      array_agg(
        public.brainilab_normalize_topic_rush_answer(x.value#>>'{}')
      ) filter(
        where public.brainilab_normalize_topic_rush_answer(x.value#>>'{}')<>''
      ),
      '{}'::text[]
    )
    into v_aliases
    from jsonb_array_elements(
      case
        when jsonb_typeof(v_item)='object'
          then coalesce(v_item->'aliases','[]'::jsonb)
        else '[]'::jsonb
      end
    ) x;

    insert into public.topic_rush_answers(
      topic_id,
      answer_text,
      normalized_answer,
      normalized_aliases
    )
    values(
      v_topic_id,
      v_answer,
      public.brainilab_normalize_topic_rush_answer(v_answer),
      v_aliases
    );

    v_count:=v_count+1;
  end loop;

  perform public.log_brainilab_admin_action(
    'TOPIC_RUSH_TOPIC_CREATED',
    'topic_rush_topic',
    v_topic_id::text,
    jsonb_build_object(
      'external_key',v_key,
      'title',v_title,
      'target_count',p_target_count,
      'answer_count',v_count
    )
  );

  return jsonb_build_object(
    'id',v_topic_id,
    'external_key',v_key,
    'title',v_title,
    'target_count',p_target_count,
    'answer_count',v_count,
    'active',true
  );
end;
$$;

revoke execute on function public.admin_create_topic_rush_topic(
  text,text,text,integer,jsonb
) from public,anon;

grant execute on function public.admin_create_topic_rush_topic(
  text,text,text,integer,jsonb
) to authenticated;


create or replace function public.admin_toggle_topic_rush_topic(
  p_topic_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid;
  v_remaining integer;
begin
  v_uid:=public.require_brainilab_admin(
    array['owner','editor']::text[]
  );

  if not p_active then
    select count(*)::integer
      into v_remaining
    from public.topic_rush_topics trt
    where trt.is_active=true
      and trt.id<>p_topic_id;

    if v_remaining<15 then
      raise exception
        'Keep at least 15 active Topic Rush topics for the 14-day cooldown';
    end if;
  end if;

  update public.topic_rush_topics
  set
    is_active=p_active,
    updated_at=now()
  where id=p_topic_id;

  if not found then
    raise exception 'Topic Rush topic not found';
  end if;

  perform public.log_brainilab_admin_action(
    'TOPIC_RUSH_TOPIC_TOGGLED',
    'topic_rush_topic',
    p_topic_id::text,
    jsonb_build_object('active',p_active)
  );
end;
$$;

revoke execute on function public.admin_toggle_topic_rush_topic(
  uuid,boolean
) from public,anon;

grant execute on function public.admin_toggle_topic_rush_topic(
  uuid,boolean
) to authenticated;


-- ============================================================
-- TABLE SECURITY
-- ============================================================

alter table public.topic_rush_settings enable row level security;
alter table public.topic_rush_topics enable row level security;
alter table public.topic_rush_answers enable row level security;
alter table public.daily_topic_rush enable row level security;

revoke all on table public.topic_rush_settings
  from anon,authenticated;

revoke all on table public.topic_rush_topics
  from anon,authenticated;

revoke all on table public.topic_rush_answers
  from anon,authenticated;

revoke all on table public.daily_topic_rush
  from anon,authenticated;

-- ============================================================
-- BACKFILL CURRENT DERIVED STATE
-- ============================================================

do $$
declare
  v_player record;
  v_group record;
begin
  for v_player in
    select p.user_id
    from public.profiles p
  loop
    perform public.refresh_brainilab_player_progression(
      v_player.user_id
    );
  end loop;

  for v_group in
    select g.id
    from public.groups g
    where g.status='active'
  loop
    perform public.refresh_brainilab_group_stats(v_group.id);
    perform public.refresh_brainilab_group_game_rank_stats(v_group.id);
  end loop;
end;
$$;

commit;


-- ============================================================
-- VERIFICATION QUERIES — RUN SEPARATELY
-- ============================================================
--
-- Topic pool:
--
-- select
--   count(*) as active_topics,
--   min(answer_count) as smallest_topic
-- from (
--   select
--     t.id,
--     count(a.id) as answer_count
--   from public.topic_rush_topics t
--   left join public.topic_rush_answers a
--     on a.topic_id=t.id
--   where t.is_active=true
--   group by t.id
-- ) x;
--
-- Expected: active_topics >= 15 and smallest_topic >= 20.
--
-- Current/future assignment:
--
-- select
--   dc.challenge_date,
--   dc.daily_number,
--   t.title,
--   t.target_count
-- from public.daily_challenges dc
-- left join public.daily_topic_rush dtr
--   on dtr.daily_challenge_id=dc.id
-- left join public.topic_rush_topics t
--   on t.id=dtr.topic_id
-- where dc.challenge_date>=current_date
-- order by dc.challenge_date;
--
-- Runtime flag:
--
-- select *
-- from public.runtime_flags
-- where flag_key='topicrush_enabled';
--
-- Player daily schema:
--
-- select column_name
-- from information_schema.columns
-- where table_schema='public'
--   and table_name='player_daily_stats'
--   and column_name='topicrush_points';
